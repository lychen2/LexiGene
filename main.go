package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"

	"github.com/egoist/mygo"
	"lexigene/internal/api"
	"lexigene/internal/web"
	"lexigene/internal/wiktionary"
)

const version = "1.0.0"

// The development default is the client identifier supplied with this project.
// Set LEXIGENE_WIKTIONARY_USER_AGENT to include your contact URL or email before distribution.
const defaultWiktionaryUA = "LexiGene/1.0 (contact)"

func main() {
	serve := flag.Bool("serve", false, "serve the built frontend and Go API in a browser")
	port := flag.Int("port", 3000, "loopback HTTP port for --serve")
	frontend := flag.String("frontend", "dist", "built frontend directory for --serve")
	flag.Parse()

	userAgent := os.Getenv("LEXIGENE_WIKTIONARY_USER_AGENT")
	if userAgent == "" {
		userAgent = defaultWiktionaryUA
	}
	wiki := wiktionary.NewClient(wiktionary.Options{
		Endpoint:  os.Getenv("LEXIGENE_WIKTIONARY_ENDPOINT"),
		UserAgent: userAgent,
	})
	service := api.NewHandler(api.Options{Wiktionary: wiki})

	if *serve {
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("LexiGene Go service: http://%s\n", listener.Addr())
		log.Fatal(http.Serve(listener, web.NewHandler(os.DirFS(*frontend), service)))
	}

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
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
