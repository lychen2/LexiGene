//go:build !headless

package main

import (
	"net/http"

	"github.com/egoist/mygo"
)

// launchDesktop opens the native mygo window. Builds tagged "headless" (the
// Android service) exclude this file, which is what keeps that executable free
// of the graphical toolkit and its dynamic libc dependency.
func launchDesktop(service http.Handler) error {
	mygo.App.SetName("LexiGene")
	mygo.App.SetVersion(version)
	mygo.Protocol.Handle("api", service)
	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title: "LexiGene — 词汇的另一面", URL: "/",
			Width: 1440, Height: 1000, MinWidth: 390, MinHeight: 600,
			BackgroundColor: "#f3f4ee",
		})
	})
	return mygo.App.Run()
}
