# Unit tests: standard EVM. Arc tests: arc-forge against an Arc testnet fork (real USDC system contract).
ARC_RPC ?= https://rpc.testnet.arc.io

.PHONY: build test test-ci test-arc fmt fmt-check coverage slither

build:
	forge build --sizes

test:
	forge test --match-path 'test/unit/**'

test-ci:
	FOUNDRY_PROFILE=ci forge test --match-path 'test/unit/**'

test-arc:
	arc-forge test --network arc --fork-url $(ARC_RPC) --match-path 'test/arc/**'

fmt:
	forge fmt

fmt-check:
	forge fmt --check

coverage:
	forge coverage --match-path 'test/unit/**' --no-match-coverage 'test|script' --report summary

slither:
	slither . --filter-paths 'lib|test' --exclude-dependencies
