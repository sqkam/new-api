FRONTEND_DIR = ./web/default
FRONTEND_CLASSIC_DIR = ./web/classic
BACKEND_DIR = .
VERSION ?= $(shell cat VERSION 2>/dev/null || echo "dev")
DOCKER_IMAGE ?= sqkam/new-api
PLATFORM ?= linux/amd64

.PHONY: all build build-frontend build-frontend-classic build-all-frontends build-backend docker-image docker start-backend dev dev-api dev-web dev-web-classic clean install-macos-launch

all: build

build: build-all-frontends build-backend docker-image
	@echo "Build complete (version: $(VERSION))"

build-frontend:
	@echo "Building default frontend..."
	@cd $(FRONTEND_DIR) && bun install && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(VERSION) bun run build

build-frontend-classic:
	@echo "Building classic frontend..."
	@cd $(FRONTEND_CLASSIC_DIR) && bun install && VITE_REACT_APP_VERSION=$(VERSION) bun run build

build-all-frontends: build-frontend build-frontend-classic

build-backend: build-all-frontends
	@echo "Building backend..."
	@cd $(BACKEND_DIR) && CGO_ENABLED=1 go build -ldflags "-s -w -X main.Version=$(VERSION)" -o new-api .

start-backend:
	@echo "Starting backend dev server..."
	@cd $(BACKEND_DIR) && go run main.go &

dev-api:
	@echo "Starting backend services (docker)..."
	@docker compose -f docker-compose.dev.yml up -d

dev-web:
	@echo "Starting frontend dev server..."
	@cd $(FRONTEND_DIR) && bun install && bun run dev

dev-web-classic:
	@echo "Starting classic frontend dev server..."
	@cd $(FRONTEND_CLASSIC_DIR) && bun install && bun run dev

dev: dev-api dev-web

docker-image:
	@echo "Building docker image $(DOCKER_IMAGE)..."
	docker build --platform $(PLATFORM) . -t $(DOCKER_IMAGE)
	docker push $(DOCKER_IMAGE)

docker:
	@echo "Building docker image $(DOCKER_IMAGE)..."
	docker build --platform $(PLATFORM) . -t $(DOCKER_IMAGE)

install-macos-launch:
	@echo "Installing macOS launchd plist..."
	@mkdir -p /usr/local/var/log/new-api
	@mkdir -p /usr/local/var/new-api
	@cp com.new-api.plist ~/Library/LaunchAgents/
	@launchctl load ~/Library/LaunchAgents/com.new-api.plist
	@echo "Installed and loaded. Edit ~/Library/LaunchAgents/com.new-api.plist to configure env vars."
	@echo "Manage with: launchctl start|stop|unload com.new-api"

clean:
	@echo "Cleaning..."
	@rm -f new-api
	@cd $(FRONTEND_DIR) && rm -rf dist node_modules/.cache
	@cd $(FRONTEND_CLASSIC_DIR) && rm -rf dist node_modules/.cache
