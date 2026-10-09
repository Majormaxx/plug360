# Unit tests: standard EVM. Arc tests: arc-forge against an Arc testnet fork (real USDC system contract).
ARC_RPC ?= https://rpc.testnet.arc.io

.PHONY: build test test-ci test-arc fmt fmt-check coverage slither mutate invariant-stats hooks

build:
	forge build --sizes

test:
	forge test --no-match-path 'test/arc/**'

test-ci:
	FOUNDRY_PROFILE=ci forge test --no-match-path 'test/arc/**'

test-arc:
	PATH="$$HOME/.local/bin:$$PATH" arc-forge test --network arc --fork-url $(ARC_RPC) --match-path 'test/arc/**'

fmt:
	forge fmt

fmt-check:
	forge fmt --check

coverage:
	forge coverage --no-match-path 'test/arc/**' --no-match-coverage 'test|script' --report summary

slither:
	PATH="$$HOME/.local/bin:$$PATH" slither . --filter-paths 'lib|test' --exclude-dependencies --fail-medium

mutate:
	python3 script/mutate.py

invariant-stats:
	rm -f cache/invariant-stats.csv
	forge test --match-path 'test/invariant/**' --mt invariant_heldCap
	script/invariant-stats.sh

hooks:
	cd .. && for h in pre-commit pre-push; do ln -sf ../../scripts/hooks/$$h .git/hooks/$$h; done
