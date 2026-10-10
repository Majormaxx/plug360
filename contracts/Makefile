# Unit tests: standard EVM. Arc tests: arc-forge against an Arc testnet fork (real USDC system contract).
ARC_RPC ?= https://rpc.testnet.arc.io

.PHONY: build test test-ci test-arc fmt fmt-check coverage slither mutate invariant-stats hooks rehearse deploy verify list-plug proofs proof-table

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

# ---------------------------------------------------------------- deployment
# Keys and RPC come from an env file outside the repo. NETWORK=testnet (default) or NETWORK=mainnet.
# Mainnet targets refuse to run unless CONFIRM=mainnet is set on the command line.
NETWORK ?= testnet
ENV_FILE ?= $(HOME)/plug360-internal/$(NETWORK).env
ARC_GAS = --network arc --with-gas-price 25gwei --priority-gas-price 1gwei
LOAD = set -a; . $(ENV_FILE); set +a; export PATH="$$HOME/.local/bin:$$PATH";
GUARD = if [ "$(NETWORK)" = mainnet ] && [ "$(CONFIRM)" != mainnet ]; then echo "refusing: add CONFIRM=mainnet"; exit 1; fi;

rehearse:
	bash script/rehearse-fork.sh

deploy:
	@$(GUARD) $(LOAD) OWNER=$${OWNER_ADDR:?} arc-forge script script/Deploy.s.sol --rpc-url $$RPC_URL --private-key $$DEPLOYER_KEY --broadcast $(ARC_GAS)

verify:
	@$(LOAD) ESCROW=$$(python3 -c 'import json; print(json.load(open("deployments/'$$CHAIN'.json"))["escrow"])'); \
	arc-forge verify-contract $$ESCROW src/DealEscrow.sol:DealEscrow --chain $$CHAIN --verifier sourcify \
	  --constructor-args $$(cast abi-encode "constructor(address,address)" 0x3600000000000000000000000000000000000000 $$OWNER_ADDR)

list-plug:
	@$(GUARD) $(LOAD) ESCROW=$$(python3 -c 'import json; print(json.load(open("deployments/'$$CHAIN'.json"))["escrow"])') \
	arc-forge script script/Admin.s.sol --sig "setPlugLevel(address,uint8)" $${PLUG:-$$PLUG_ADDR} $${LEVEL:-1} \
	  --rpc-url $$RPC_URL --private-key $$OWNER_KEY --broadcast $(ARC_GAS)

proofs:
	@$(GUARD) $(LOAD) ESCROW=$$(python3 -c 'import json; print(json.load(open("deployments/'$$CHAIN'.json"))["escrow"])') \
	SELLER_KEY=$$SELLER_KEY PLUG_KEY=$$PLUG_KEY BUYER_KEY=$$BUYER_KEY \
	arc-forge script script/Proofs.s.sol --rpc-url $$RPC_URL --broadcast --slow $(ARC_GAS)

proof-table:
	@$(LOAD) python3 script/proof-table.py $$CHAIN
