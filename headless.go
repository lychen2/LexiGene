//go:build headless

package main

import (
	"fmt"
	"net/http"
)

// launchDesktop is unreachable in the headless build: the Android package always
// starts the bundled service with --serve on a loopback port.
func launchDesktop(http.Handler) error {
	return fmt.Errorf("this build has no desktop window; start it with --serve --port PORT --frontend DIR")
}
