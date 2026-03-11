package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"time"
)

type HealthResponse struct {
	Status           string    `json:"status"`
	Timestamp        time.Time `json:"timestamp"`
	Service          string    `json:"service"`
	CapacityProvider string    `json:"capacityProvider"`
}

type StatusResponse struct {
	Service          string            `json:"service"`
	CapacityProvider string            `json:"capacityProvider"`
	Hostname         string            `json:"hostname"`
	Platform         string            `json:"platform"`
	Arch             string            `json:"arch"`
	GoVersion        string            `json:"goVersion"`
	Timestamp        time.Time         `json:"timestamp"`
}

type ErrorResponse struct {
	Error     string    `json:"error"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

type InfoResponse struct {
	Message          string    `json:"message"`
	Service          string    `json:"service"`
	CapacityProvider string    `json:"capacityProvider"`
	Hostname         string    `json:"hostname"`
	Timestamp        time.Time `json:"timestamp"`
	Version          string    `json:"version"`
}

func main() {
	port := getEnv("PORT", "8080")
	serviceName := getEnv("SERVICE_NAME", "unknown")
	capacityProvider := getEnv("CAPACITY_PROVIDER", "unknown")
	hostname, _ := os.Hostname()

	// Health check endpoint
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(HealthResponse{
			Status:           "healthy",
			Timestamp:        time.Now(),
			Service:          serviceName,
			CapacityProvider: capacityProvider,
		})
	})

	// Root endpoint
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(InfoResponse{
			Message:          "ECS Fargate Spot Failover Sample Application (Go)",
			Service:          serviceName,
			CapacityProvider: capacityProvider,
			Hostname:         hostname,
			Timestamp:        time.Now(),
			Version:          "1.0.0",
		})
	})

	// Status endpoint
	http.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(StatusResponse{
			Service:          serviceName,
			CapacityProvider: capacityProvider,
			Hostname:         hostname,
			Platform:         runtime.GOOS,
			Arch:             runtime.GOARCH,
			GoVersion:        runtime.Version(),
			Timestamp:        time.Now(),
		})
	})

	// Readiness probe
	http.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ready":     true,
			"service":   serviceName,
			"timestamp": time.Now(),
		})
	})

	// Liveness probe
	http.HandleFunc("/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"alive":     true,
			"timestamp": time.Now(),
		})
	})

	// Simulate failure endpoint
	http.HandleFunc("/simulate-failure", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error:     "Simulated failure",
			Message:   "This is a test failure to trigger failover",
			Timestamp: time.Now(),
		})

		// Exit after 5 seconds
		go func() {
			time.Sleep(5 * time.Second)
			os.Exit(1)
		}()
	})

	fmt.Printf("Sample app starting on port %s\n", port)
	fmt.Printf("Service: %s\n", serviceName)
	fmt.Printf("Capacity Provider: %s\n", capacityProvider)
	fmt.Printf("Hostname: %s\n", hostname)

	// Start server
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		fmt.Printf("Server error: %v\n", err)
		os.Exit(1)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
