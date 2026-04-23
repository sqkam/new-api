FRONTEND_DIR = ./web
BACKEND_DIR = .
VERSION ?= $(shell cat VERSION 2>/dev/null || echo "dev")

.PHONY: all build build-frontend build-backend start clean

all: build

build: build-frontend build-backend
	@echo "Build complete (version: $(VERSION))"

build-frontend:
	@echo "Building frontend..."
	@cd $(FRONTEND_DIR) && bun install && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(VERSION) bun run build

build-backend: build-frontend
	@echo "Building backend..."
	@cd $(BACKEND_DIR) && CGO_ENABLED=1 go build -ldflags "-s -w -X main.Version=$(VERSION)" -o new-api .

start:
	@echo "Starting backend dev server..."
	@cd $(BACKEND_DIR) && go run main.go

clean:
	@echo "Cleaning..."
	@rm -f new-api
	@cd $(FRONTEND_DIR) && rm -rf dist node_modules/.cache
