package dev.lexigene.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * LexiGene on Android: the bundled Go service serves the pre-rendered learning
 * desk and the same JSON/SSE APIs as the desktop build. The WebView only ever
 * loads that loopback origin, which also keeps IndexedDB history stable.
 */
public class MainActivity extends Activity {
    private static final String TAG = "LexiGene";
    private static final int PORT = 47821;
    private static final String ORIGIN = "http://127.0.0.1:" + PORT;
    private static final int REQUEST_OPEN_JSON = 1001;
    private static final int REQUEST_SAVE_FILE = 1002;

    private FrameLayout contentRoot;
    private WebView webView;
    private Process server;
    private ValueCallback<Uri[]> pendingChooser;
    private byte[] pendingSave;
    private String pendingSaveName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Target SDK 35+ draws edge-to-edge. Keep the WebView's fixed controls
        // inside system bars, while the root supplies their paper background.
        contentRoot = new FrameLayout(this);
        contentRoot.setFitsSystemWindows(true);
        contentRoot.setBackgroundColor(0xfff3f4ee);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        setContentView(contentRoot);
        webView = new WebView(this);
        configureWebView();

        TextView notice = new TextView(this);
        notice.setText("正在准备词汇研究台…");
        notice.setTextSize(15);
        notice.setPadding(48, 160, 48, 48);
        showContent(notice);

        new Thread(() -> {
            try {
                File www = extractFrontend();
                startServer(www);
                if (!waitForServer()) {
                    showMessage("本地服务启动失败，请重新打开应用。");
                    return;
                }
                runOnUiThread(() -> {
                    showContent(webView);
                    webView.loadUrl(ORIGIN + "/");
                });
            } catch (Exception failure) {
                Log.e(TAG, "Startup failed", failure);
                showMessage("启动失败：" + failure.getMessage());
            }
        }, "lexigene-startup").start();
    }

    private void showContent(View view) {
        contentRoot.removeAllViews();
        contentRoot.addView(view, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        webView.addJavascriptInterface(new ExportBridge(), "LexiGeneBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri.toString().startsWith(ORIGIN)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // A missing handler for an external link leaves the learning desk untouched.
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingChooser != null) pendingChooser.onReceiveValue(null);
                pendingChooser = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain"});
                try {
                    startActivityForResult(intent, REQUEST_OPEN_JSON);
                    return true;
                } catch (Exception failure) {
                    pendingChooser = null;
                    return false;
                }
            }
        });
    }

    private File extractFrontend() throws IOException {
        File root = new File(getFilesDir(), "www");
        File stamp = new File(root, ".version");
        String version;
        try {
            version = String.valueOf(getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime);
        } catch (android.content.pm.PackageManager.NameNotFoundException missing) {
            version = "unknown";
        }
        if (stamp.isFile()) {
            try (InputStream in = new java.io.FileInputStream(stamp)) {
                byte[] bytes = new byte[(int) stamp.length()];
                int read = in.read(bytes);
                if (read > 0 && new String(bytes, 0, read, StandardCharsets.UTF_8).equals(version)) return root;
            }
        }
        deleteTree(root);
        copyAssetTree("www", root);
        if (!root.isDirectory()) throw new IOException("前端资源缺失");
        try (FileOutputStream out = new FileOutputStream(stamp)) {
            out.write(version.getBytes(StandardCharsets.UTF_8));
        }
        return root;
    }

    private void copyAssetTree(String path, File target) throws IOException {
        String[] children = getAssets().list(path);
        if (children == null || children.length == 0) {
            if (!target.getParentFile().isDirectory() && !target.getParentFile().mkdirs()) throw new IOException("无法创建目录");
            try (InputStream in = getAssets().open(path); OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            }
            return;
        }
        if (!target.isDirectory() && !target.mkdirs()) throw new IOException("无法创建目录");
        for (String child : children) copyAssetTree(path + "/" + child, new File(target, child));
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private void startServer(File www) throws IOException {
        File binary = new File(getApplicationInfo().nativeLibraryDir, "liblexigene.so");
        if (!binary.isFile()) throw new IOException("缺少本地服务程序");
        //noinspection ResultOfMethodCallIgnored
        binary.setExecutable(true);
        ProcessBuilder builder = new ProcessBuilder(
            binary.getAbsolutePath(), "--serve", "--port", String.valueOf(PORT), "--frontend", www.getAbsolutePath());
        builder.redirectErrorStream(true);
        server = builder.start();
        new Thread(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(server.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) Log.i(TAG, "server: " + line);
            } catch (IOException ignored) {
                // The process ending closes its output; nothing further to read.
            }
        }, "lexigene-server-log").start();
    }

    private boolean waitForServer() {
        for (int attempt = 0; attempt < 100; attempt++) {
            if (server != null && !server.isAlive()) return false;
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(ORIGIN + "/api/health").openConnection();
                connection.setConnectTimeout(300);
                connection.setReadTimeout(300);
                if (connection.getResponseCode() == 200) {
                    connection.disconnect();
                    return true;
                }
                connection.disconnect();
            } catch (Exception ignored) {
                // The listener is not ready yet.
            }
            try {
                Thread.sleep(150);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    private void showMessage(String message) {
        runOnUiThread(() -> {
            TextView notice = new TextView(this);
            notice.setText(message);
            notice.setTextSize(15);
            notice.setPadding(48, 160, 48, 48);
            showContent(notice);
        });
    }

    /** Saves exported JSON, TSV, and APKG files through the user's chosen location. */
    private final class ExportBridge {
        @JavascriptInterface
        public void save(String name, String mime, String base64) {
            byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException invalid) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "导出数据无法读取。", Toast.LENGTH_LONG).show());
                return;
            }
            runOnUiThread(() -> {
                pendingSave = bytes;
                pendingSaveName = name;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                intent.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(intent, REQUEST_SAVE_FILE);
                } catch (Exception failure) {
                    pendingSave = null;
                    Toast.makeText(MainActivity.this, "无法打开保存位置。", Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_OPEN_JSON) {
            ValueCallback<Uri[]> callback = pendingChooser;
            pendingChooser = null;
            if (callback == null) return;
            Uri uri = resultCode == RESULT_OK && data != null && data.getData() != null ? data.getData() : null;
            callback.onReceiveValue(uri == null ? null : new Uri[]{uri});
            return;
        }
        if (requestCode == REQUEST_SAVE_FILE) {
            byte[] bytes = pendingSave;
            String name = pendingSaveName;
            pendingSave = null;
            pendingSaveName = null;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (bytes == null || uri == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("empty stream");
                out.write(bytes);
                Toast.makeText(this, "已保存 " + name, Toast.LENGTH_SHORT).show();
            } catch (Exception failure) {
                Log.e(TAG, "Saving export failed", failure);
                Toast.makeText(this, "保存失败，请重试。", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("LexiGeneBridge");
            webView.destroy();
            webView = null;
        }
        if (server != null) {
            server.destroy();
            server = null;
        }
        super.onDestroy();
    }
}
