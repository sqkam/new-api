FRONTEND_DIR = ./web/default
FRONTEND_CLASSIC_DIR = ./web/classic
BACKEND_DIR = .
VERSION ?= $(shell cat VERSION 2>/dev/null || echo "dev")
DOCKER_IMAGE ?= sqkam/new-api
PLATFORM ?= linux/amd64
DEV_FRONTEND_DEFAULT_PORT ?= 5173
DEV_FRONTEND_CLASSIC_PORT ?= 5174
DEV_COMPOSE_FILE = docker-compose.dev.yml
DEV_POSTGRES_SERVICE = postgres
DEV_BACKEND_SERVICE = new-api
DEV_POSTGRES_DB = new-api
DEV_POSTGRES_USER = root
DEV_SQLITE_PATH ?= one-api.db

.PHONY: all build build-frontend build-frontend-classic build-all-frontends build-backend docker-image docker start-backend dev dev-api dev-api-rebuild dev-web dev-web-classic reset-setup clean

all: build

build: build-backend docker-image
	@echo "Build complete (version: $(VERSION))"

build-frontend:
	@echo "Building default frontend..."
	@cd ./web && bun install
	@cd $(FRONTEND_DIR) && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(VERSION) bun run build

build-frontend-classic:
	@echo "Building classic frontend..."
	@cd ./web && bun install
	@cd $(FRONTEND_CLASSIC_DIR) && VITE_REACT_APP_VERSION=$(VERSION) bun run build

build-all-frontends: build-frontend build-frontend-classic

build-backend: build-all-frontends
	@echo "Building backend..."
	@cd $(BACKEND_DIR) && CGO_ENABLED=1 go build -ldflags "-s -w -X main.Version=$(VERSION)" -o new-api .

start-backend:
	@echo "Starting backend dev server..."
	@cd $(BACKEND_DIR) && go run main.go &

dev-api:
	@echo "Starting backend services (docker)..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d

dev-api-rebuild:
	@echo "Rebuilding and starting backend service (docker)..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d --build $(DEV_BACKEND_SERVICE)

dev-web:
	@echo "Starting both frontend dev servers..."
	@echo "Default frontend: http://localhost:$(DEV_FRONTEND_DEFAULT_PORT)"
	@echo "Classic frontend: http://localhost:$(DEV_FRONTEND_CLASSIC_PORT)"
	@cd ./web && bun install
	@(cd $(FRONTEND_DIR) && bun run dev -- --host 0.0.0.0 --port $(DEV_FRONTEND_DEFAULT_PORT)) & \
		default_pid=$$!; \
		(cd $(FRONTEND_CLASSIC_DIR) && bun run dev -- --host 0.0.0.0 --port $(DEV_FRONTEND_CLASSIC_PORT)) & \
		classic_pid=$$!; \
		trap 'kill $$default_pid $$classic_pid 2>/dev/null; wait $$default_pid $$classic_pid 2>/dev/null; exit 130' INT TERM; \
		while kill -0 $$default_pid 2>/dev/null && kill -0 $$classic_pid 2>/dev/null; do \
			sleep 1; \
		done; \
		if ! kill -0 $$default_pid 2>/dev/null; then \
			wait $$default_pid; \
			status=$$?; \
			kill $$classic_pid 2>/dev/null; \
			wait $$classic_pid 2>/dev/null; \
			exit $$status; \
		fi; \
		wait $$classic_pid; \
		status=$$?; \
		kill $$default_pid 2>/dev/null; \
		wait $$default_pid 2>/dev/null; \
		exit $$status

dev-web-classic:
	@echo "Starting classic frontend dev server..."
	@cd ./web && bun install
	@cd $(FRONTEND_CLASSIC_DIR) && bun run dev -- --host 0.0.0.0 --port $(DEV_FRONTEND_CLASSIC_PORT)

dev: dev-api dev-web

docker-image:
	@echo "Building docker image $(DOCKER_IMAGE)..."
	docker build --platform $(PLATFORM) . -t $(DOCKER_IMAGE)
	docker push $(DOCKER_IMAGE)

docker:
	@echo "Building docker image $(DOCKER_IMAGE)..."
	docker build --platform $(PLATFORM) . -t $(DOCKER_IMAGE)

clean:
	@echo "Cleaning..."
	@rm -f new-api
	@cd $(FRONTEND_DIR) && rm -rf dist node_modules/.cache
	@cd $(FRONTEND_CLASSIC_DIR) && rm -rf dist node_modules/.cache

reset-setup:
	@echo "Resetting local setup wizard state..."
	@if docker compose -f $(DEV_COMPOSE_FILE) ps --services --status running | grep -qx "$(DEV_POSTGRES_SERVICE)"; then \
		echo "Detected running docker dev PostgreSQL. Removing setup record and root users..."; \
		docker compose -f $(DEV_COMPOSE_FILE) exec -T $(DEV_POSTGRES_SERVICE) \
			psql -U $(DEV_POSTGRES_USER) -d $(DEV_POSTGRES_DB) \
			-c 'DELETE FROM setups;' \
			-c 'DELETE FROM users WHERE role = 100;' \
			-c "DELETE FROM options WHERE key IN ('SelfUseModeEnabled', 'DemoSiteEnabled');"; \
		echo "Restarting docker dev backend so setup status is recalculated..."; \
		docker compose -f $(DEV_COMPOSE_FILE) restart $(DEV_BACKEND_SERVICE); \
	elif db_path="$${SQLITE_PATH:-$(DEV_SQLITE_PATH)}"; db_path="$${db_path%%\?*}"; [ -f "$$db_path" ]; then \
		db_path="$${SQLITE_PATH:-$(DEV_SQLITE_PATH)}"; \
		db_path="$${db_path%%\?*}"; \
		echo "Detected local SQLite database: $$db_path"; \
		sqlite3 "$$db_path" \
			"DELETE FROM setups; DELETE FROM users WHERE role = 100; DELETE FROM options WHERE key IN ('SelfUseModeEnabled', 'DemoSiteEnabled');"; \
		echo "SQLite setup state reset. Restart the local backend process before testing the setup wizard."; \
	else \
		echo "No running docker dev PostgreSQL or local SQLite database found."; \
		echo "Start the dev stack with 'make dev-api', or set SQLITE_PATH/DEV_SQLITE_PATH to your local SQLite database."; \
		exit 1; \
	fi
