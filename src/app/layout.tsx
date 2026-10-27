import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const editorial = localFont({
  src: '../../public/fonts/NotoSerifDisplay-Regular.woff2',
  weight: '400',
  display: 'swap',
  variable: '--font-editorial',
  adjustFontFallback: 'Times New Roman',
});
export const metadata: Metadata = { title: 'LexiGene — 词汇的另一面', description: '从词源到语境，用三个维度、八个模块，真正拥有一个英语词汇。' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN" className={editorial.variable}><body>{children}</body></html>; }
