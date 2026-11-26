default: build

all: test

test: build
	$(MAKE) -C core test
	$(MAKE) -C core budget-bench
	$(MAKE) -C orchestrator test

# Refresh Soroban contract test snapshots after an SDK upgrade.
# Usage: make update-snapshots
update-snapshots:
	UPDATE_SNAPSHOTS=1 $(MAKE) -C core test

build:
	$(MAKE) -C core build
	$(MAKE) -C orchestrator build

check-size:
	$(MAKE) -C core check-size

# Differential fuzzing (issue #253): native vs compiled-WASM execution.
# Requires the WASM artifacts from `build`; fails if they are missing.
differential: build
	cd tests/e2e && REQUIRE_WASM=1 cargo test --test differential_wasm

fmt:
	$(MAKE) -C core fmt
	$(MAKE) -C orchestrator fmt

clippy:
	$(MAKE) -C core clippy
	$(MAKE) -C orchestrator clippy

check:
	$(MAKE) -C core check
	$(MAKE) -C orchestrator check

doc:
	$(MAKE) -C core doc
	$(MAKE) -C orchestrator doc

relayer-install:
	cd services/relayer && npm ci

relayer-test: relayer-install
	cd services/relayer && npm run typecheck && npm test

clean:
	$(MAKE) -C core clean
	$(MAKE) -C orchestrator clean

crank-install:
	cd services/crank-worker && npm ci

crank-build: crank-install
	cd services/crank-worker && npm run build

crank-test: crank-install
	cd services/crank-worker && npm test

.PHONY: differential default all test build check-size fmt clippy check doc clean crank-install crank-build crank-test
.PHONY: differential default all test build check-size fmt clippy check doc relayer-install relayer-test clean

# Local standalone Stellar stack (issue #363). Run `make build` first for the seed profile.
localnet-up:
	docker compose --profile seed up -d

localnet-down:
	docker compose --profile seed down

localnet-reset:
	docker compose --profile seed down -v --remove-orphans
	docker compose --profile seed up -d

.PHONY: localnet-up localnet-down localnet-reset
