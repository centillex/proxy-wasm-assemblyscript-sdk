.PHONY: test native monitor

test:
	npm ci --ignore-scripts
	npm test

native:
	npm run test:native

monitor:
	npm run monitor
