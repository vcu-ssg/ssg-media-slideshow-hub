# -------------------------------------------
# Makefile for ssg-kiosk-photo-player
# -------------------------------------------

# Default settings
APP_NAME := ssg-media-slideshow-hub
CONTAINER := media-hub
PORT := 3000

SERVER_HOST := localhost

AUTOSTART_FILE := $(HOME)/.config/lxsession/LXDE-pi/autostart
AUTOSTART_SNIPPET := @bash -c "cd $(HOME)/projects/$(APP_NAME) && make up" && \
                     @chromium-browser --kiosk --noerrdialogs --disable-infobars \
                     --check-for-update-interval=31536000 --incognito --no-first-run http://$(SERVER_HOST):$(PORT)

# Docker image and tag
DOCKER_IMAGE := $(APP_NAME):latest
DOCKER_IMAGE_REMOTE := $(DOCKER_USER)/$(APP_NAME):latest

# Detect if docker compose v2 (modern syntax)
# Compose environment layering: ~/.env (personal) + ./.env (project)
DOCKER_COMPOSE := docker compose
ENV_FILES := --env-file ~/.env --env-file .env

DOCKER_USER := jleonard99
LOGO = @echo "📸"

# -----------------------------
# Primary Targets
# -----------------------------

.PHONY: help install build up down logs restart clean rebuild prune status

help:
	@echo ""
	@echo "📸  $(APP_NAME) — Makefile Commands"
	@echo "-------------------------------------------"
	@echo "make install     - Install Node dependencies locally"
	@echo "make build       - Build Docker image"
	@echo "make up          - Start container (detached)"
	@echo "make down        - Stop and remove container"
	@echo "make logs        - Tail container logs"
	@echo "make restart     - Restart container"
	@echo "make clean       - Remove node_modules and build artifacts"
	@echo "make rebuild     - Rebuild Docker image and restart"
	@echo "make prune       - Remove dangling Docker images"
	@echo "make status      - Show running containers"
	@echo "make kiosk       - Start chromium pointing at server"
	@echo ""

# -----------------------------
# Local development
# -----------------------------

install:
	npm install

dev:
	@echo "🚀 Starting local Node server on port $(PORT)"
	NODE_ENV=development node src/server.js

clean:
	rm -rf node_modules
	rm -f npm-debug.log
	rm -rf media/cache        # all generated images
	rm -rf media/logs         # runtime logs
	rm -rf public/hls         # HLS output if mediamtx writes here
	rm -rf src/backend/scripts/precache-output   # if generated
	rm -f decoded-topology.xml
	rm -f parsed-topology.json


# -----------------------------
# Docker targets
# -----------------------------

build:
	$(DOCKER_COMPOSE) $(ENV_FILES) build

up:
	$(DOCKER_COMPOSE) $(ENV_FILES) up -d --build
	@echo "✅ Server running at http://$(SERVER_HOST):$(PORT)"

down:
	$(DOCKER_COMPOSE) $(ENV_FILES) down

logs:
	$(DOCKER_COMPOSE) $(ENV_FILES) logs -f

restart: down up
	@echo "restart complete"

rebuild:
	$(DOCKER_COMPOSE) $(ENV_FILES) up -d --build --force-recreate
	@echo "rebuild complete"

status:
	@docker ps --filter "name=$(CONTAINER)"

prune:
	docker image prune -f

# -----------------------------
# Kiosk target (launch Chromium)
# -----------------------------

kiosk:
	@echo "🚀 Launching Chromium in kiosk mode at http://$(SERVER_HOST):$(PORT)?client-host=$(shell hostname)"
	@chromium-browser --kiosk --noerrdialogs --disable-infobars \
		--check-for-update-interval=31536000 \
		--incognito http://$(SERVER_HOST):$(PORT)?client-host=$(shell hostname)

# -----------------------------
# Raspberry Pi autostart setup
# -----------------------------

autostart:
	@echo "🧩 Configuring Raspberry Pi autostart (production mode)..."
	@mkdir -p $(dir $(AUTOSTART_FILE))
	@if ! grep -q "$(APP_NAME)" $(AUTOSTART_FILE) 2>/dev/null; then \
		echo "@bash -c 'cd $(HOME)/projects/$(APP_NAME) && make pull && make run-production'" >> $(AUTOSTART_FILE); \
		echo "@chromium-browser --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 --incognito --no-first-run http://$(SERVER_HOST):$(PORT)" >> $(AUTOSTART_FILE); \
		echo "✅ Added kiosk autostart entry for production mode."; \
	else \
		echo "⚠️  Autostart already configured."; \
	fi

uninstall-autostart:
	@echo "🧹 Removing kiosk autostart from LXDE..."
	@if test -f $(AUTOSTART_FILE); then \
		sed -i '/ssg-kiosk-photo-player/d' $(AUTOSTART_FILE); \
		sed -i '/chromium-browser --kiosk/d' $(AUTOSTART_FILE); \
		echo "✅ Autostart entries removed."; \
	else \
		echo "⚠️  No autostart file found at $(AUTOSTART_FILE)."; \
	fi

# -------------------------------------------
# Push image to Docker Hub
# -------------------------------------------

push:
	@if [ -z "$(DOCKER_USER)" ]; then \
		echo "❌ Please set DOCKER_USER, e.g. make push DOCKER_USER=johnleonard"; \
		exit 1; \
	fi
	@echo "🚀 Pushing $(DOCKER_IMAGE) to Docker Hub as $(DOCKER_USER)/$(DOCKER_IMAGE)"
	docker tag $(DOCKER_IMAGE) $(DOCKER_USER)/$(DOCKER_IMAGE)
	docker push $(DOCKER_USER)/$(DOCKER_IMAGE)

# -------------------------------------------
# Deploy from Docker Hub on Raspberry Pi
# -------------------------------------------


pull:
	@echo "🐋 Pulling image from Docker Hub: $(DOCKER_IMAGE_REMOTE)"
	docker pull $(DOCKER_IMAGE_REMOTE)

run:
	@echo "🚀 Running $(APP_NAME) on Raspberry Pi (local mode)..."
	docker stop $(CONTAINER) 2>/dev/null || true
	docker rm $(CONTAINER) 2>/dev/null || true
	docker run -d \
		--name $(CONTAINER) \
		--restart unless-stopped \
		-p $(PORT):3000 \
		-v $(PWD)/photos:/app/photos \
		-v $(PWD)/public:/app/public \
		-v $(PWD)/logs:/app/logs \
		-e NODE_ENV=production \
		-e CLIENT_ID=$$(hostname) \
		$(DOCKER_IMAGE_REMOTE)
	@echo "✅ $(APP_NAME) running locally at http://$(SERVER_HOST):$(PORT)"

run-production:
	@echo "🚀 Running $(APP_NAME) in production mode with Watchtower profile..."
	$(DOCKER_COMPOSE) $(ENV_FILES) --profile production up -d
	@echo "✅ $(APP_NAME) running under 'production' profile (Watchtower enabled)"

# -------------------------------------------
# Multi-arch Build and Push (Buildx)
# -------------------------------------------

buildx-create:
	@echo "🐳 Ensuring Docker Buildx builder exists..."
	@docker buildx inspect multiarch >/dev/null 2>&1 || docker buildx create --use --name multiarch
	@docker buildx use multiarch

buildx-push: buildx-create
	@if [ -z "$(DOCKER_USER)" ]; then \
		echo "⚠️  Please set DOCKER_USER, e.g. make buildx-push DOCKER_USER=jleonard99"; \
		exit 1; \
	fi
	@echo "🚀 Building and pushing multi-architecture image for amd64 + arm64..."
	docker buildx build \
		--platform linux/amd64,linux/arm64/v8 \
		-t $(DOCKER_USER)/$(APP_NAME):latest \
		--push .
	@echo "✅ Multi-arch image pushed to Docker Hub: $(DOCKER_USER)/$(APP_NAME):latest"

# -----------------------------
# Cache Management
# -----------------------------

pre-cache:
	@$(LOGO) "Generating pre-scaled image cache..."
	@node scripts/precache.js
	@$(LOGO) "✅ Pre-caching complete!"

cache-clean:
	@$(LOGO) "Removing cached images..."
	@rm -rf cache/*
	@$(LOGO) "🧹 Cache cleared."


register-to-openweather:
	curl -X POST "https://api.openweathermap.org/data/3.0/stations?appid=8275a6f4e4c2f13eef7b01b48e7e26f4" \
	-H "Content-Type: application/json" \
	-d '{
		"external_id": "KVARICHM156",
		"name": "Fan District - Richmond, VA",
		"latitude": 37.554,
		"longitude": -77.466,
		"altitude": 67
	}'

