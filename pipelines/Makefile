.PHONY: test-otel test-pypi test-ocr test-bazel-cache test-all help

help:
	@echo "Service smoke tests (Dagger manages service lifecycle)"
	@echo ""
	@echo "  make test-otel          OTel Web UI"
	@echo "  make test-pypi          PyPI mirror"
	@echo "  make test-ocr           OCI registry"
	@echo "  make test-bazel-cache   Bazel remote cache"
	@echo "  make test-all           All four in sequence"

test-otel:
	dagger call smoke-otel

test-pypi:
	dagger call smoke-pypi

test-ocr:
	dagger call smoke-ocr

test-bazel-cache:
	dagger call smoke-bazel-cache

test-all: test-otel test-pypi test-ocr test-bazel-cache
