//go:build !headless

package main

import (
	"net/http"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
)

// launchDesktop opens the native mygo window. Builds tagged "headless" (the
// Android service) exclude this file, which is what keeps that executable free
// of the graphical toolkit and its dynamic libc dependency.
func launchDesktop(service http.Handler) error {
	mygo.App.SetName("LexiGene")
	mygo.App.SetVersion(version)
	mygo.Protocol.Handle("api", service)

	// Signed releases update the installed application in place, and the
	// plugin gives "Check for Updates…" a menu item and the app a daily check.
	mygo.Use(updater.Plugin)
	mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu},
		{Label: "Update", Submenu: []*mygo.MenuItem{
			updater.MenuItem(),
		}},
		{Role: mygo.RoleEditMenu},
		{Role: mygo.RoleWindowMenu},
	}))

	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title: "LexiGene — 词汇的另一面", URL: "/",
			Width: 1440, Height: 1000, MinWidth: 390, MinHeight: 600,
			BackgroundColor: "#f3f4ee",
		})
	})
	return mygo.App.Run()
}
