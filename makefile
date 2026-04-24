FRONTEND_DIR = ./web
BACKEND_DIR = .
VERSION ?= $(shell cat VERSION 2>/dev/null || echo "dev")
DOCKER_IMAGE ?= sqkam/new-api
PLATFORM ?= linux/amd64

.PHONY: all build build-frontend build-backend docker clean

all: build

build: build-frontend build-backend docker-image
	@echo "Build complete (version: $(VERSION))"

build-frontend:
	@echo "Building frontend..."
	@cd $(FRONTEND_DIR) && bun install && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(VERSION) bun run build

build-backend: build-frontend
	@echo "Building backend..."
	@cd $(BACKEND_DIR) && CGO_ENABLED=1 go build -ldflags "-s -w -X main.Version=$(VERSION)" -o new-api .

docker-image: build-frontend
	@echo "Building docker image $(DOCKER_IMAGE)..."
	docker build --platform $(PLATFORM) . -t $(DOCKER_IMAGE)
	docker push $(DOCKER_IMAGE)

docker: build-frontend
	@echo "Building docker image $(DOCKER_IMAGE)..."
	docker build --platform $(PLATFORM) . -t $(DOCKER_IMAGE)

clean:
	@echo "Cleaning..."
	@rm -f new-api
	@cd $(FRONTEND_DIR) && rm -rf dist node_modules/.cache
