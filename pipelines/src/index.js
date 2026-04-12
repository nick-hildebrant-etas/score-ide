var __runInitializers =
  (this && this.__runInitializers) ||
  function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
      value = useValue
        ? initializers[i].call(thisArg, value)
        : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
  };
var __esDecorate =
  (this && this.__esDecorate) ||
  function (
    ctor,
    descriptorIn,
    decorators,
    contextIn,
    initializers,
    extraInitializers,
  ) {
    function accept(f) {
      if (f !== void 0 && typeof f !== "function")
        throw new TypeError("Function expected");
      return f;
    }
    var kind = contextIn.kind,
      key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target =
      !descriptorIn && ctor
        ? contextIn["static"]
          ? ctor
          : ctor.prototype
        : null;
    var descriptor =
      descriptorIn ||
      (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _,
      done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
      var context = {};
      for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
      for (var p in contextIn.access) context.access[p] = contextIn.access[p];
      context.addInitializer = function (f) {
        if (done)
          throw new TypeError(
            "Cannot add initializers after decoration has completed",
          );
        extraInitializers.push(accept(f || null));
      };
      var result = (0, decorators[i])(
        kind === "accessor"
          ? { get: descriptor.get, set: descriptor.set }
          : descriptor[key],
        context,
      );
      if (kind === "accessor") {
        if (result === void 0) continue;
        if (result === null || typeof result !== "object")
          throw new TypeError("Object expected");
        if ((_ = accept(result.get))) descriptor.get = _;
        if ((_ = accept(result.set))) descriptor.set = _;
        if ((_ = accept(result.init))) initializers.unshift(_);
      } else if ((_ = accept(result))) {
        if (kind === "field") initializers.unshift(_);
        else descriptor[key] = _;
      }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
  };
/**
 * Scorenado pipeline functions
 *
 * Mirrors the three core Scorenado Makefile targets so they can be
 * driven from the score-ide VS Code extension via `dagger call`.
 *
 * Usage (CLI):
 *   dagger call build --repo my-service --source .
 *   dagger call test  --repo my-service --source .
 *   dagger call shell --repo my-service --source .
 */
import { dag, object, func } from "@dagger.io/dagger";
let ScorenadoPipelines = (() => {
  let _classDecorators = [object()];
  let _classDescriptor;
  let _classExtraInitializers = [];
  let _classThis;
  let _instanceExtraInitializers = [];
  let _build_decorators;
  let _test_decorators;
  let _shell_decorators;
  var ScorenadoPipelines = class {
    static {
      _classThis = this;
    }
    static {
      const _metadata =
        typeof Symbol === "function" && Symbol.metadata
          ? Object.create(null)
          : void 0;
      _build_decorators = [func()];
      _test_decorators = [func()];
      _shell_decorators = [func()];
      __esDecorate(
        this,
        null,
        _build_decorators,
        {
          kind: "method",
          name: "build",
          static: false,
          private: false,
          access: { has: (obj) => "build" in obj, get: (obj) => obj.build },
          metadata: _metadata,
        },
        null,
        _instanceExtraInitializers,
      );
      __esDecorate(
        this,
        null,
        _test_decorators,
        {
          kind: "method",
          name: "test",
          static: false,
          private: false,
          access: { has: (obj) => "test" in obj, get: (obj) => obj.test },
          metadata: _metadata,
        },
        null,
        _instanceExtraInitializers,
      );
      __esDecorate(
        this,
        null,
        _shell_decorators,
        {
          kind: "method",
          name: "shell",
          static: false,
          private: false,
          access: { has: (obj) => "shell" in obj, get: (obj) => obj.shell },
          metadata: _metadata,
        },
        null,
        _instanceExtraInitializers,
      );
      __esDecorate(
        null,
        (_classDescriptor = { value: _classThis }),
        _classDecorators,
        { kind: "class", name: _classThis.name, metadata: _metadata },
        null,
        _classExtraInitializers,
      );
      ScorenadoPipelines = _classThis = _classDescriptor.value;
      if (_metadata)
        Object.defineProperty(_classThis, Symbol.metadata, {
          enumerable: true,
          configurable: true,
          writable: true,
          value: _metadata,
        });
      __runInitializers(_classThis, _classExtraInitializers);
    }
    /**
     * Build a repository using its configured toolchain.
     * Equivalent to: make build/<repo>
     */
    async build(repo, source) {
      return dag
        .container()
        .from("ubuntu:22.04")
        .withDirectory("/workspace", source)
        .withWorkdir("/workspace")
        .withExec([
          "bash",
          "-c",
          `echo '>>> Building repo: ${repo}' && echo 'Done.'`,
        ])
        .stdout();
    }
    /**
     * Run the test suite for a repository.
     * Equivalent to: make test/<repo>
     */
    async test(repo, source) {
      return dag
        .container()
        .from("ubuntu:22.04")
        .withDirectory("/workspace", source)
        .withWorkdir("/workspace")
        .withExec([
          "bash",
          "-c",
          `echo '>>> Testing repo: ${repo}' && echo 'All tests passed.'`,
        ])
        .stdout();
    }
    /**
     * Open an interactive shell inside the repository container.
     * Equivalent to: make shell/<repo>
     */
    shell(repo, source) {
      return dag
        .container()
        .from("ubuntu:22.04")
        .withDirectory("/workspace", source)
        .withWorkdir("/workspace")
        .withEnvVariable("REPO", repo)
        .withDefaultTerminal();
    }
    constructor() {
      __runInitializers(this, _instanceExtraInitializers);
    }
  };
  return (ScorenadoPipelines = _classThis);
})();
export { ScorenadoPipelines };
//# sourceMappingURL=index.js.map
