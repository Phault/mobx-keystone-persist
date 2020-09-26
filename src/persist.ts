import {
  applySnapshot,
  getSnapshot,
  modelIdKey,
  modelTypeKey,
  onSnapshot,
} from "mobx-keystone";

import AsyncLocalStorage from "./asyncLocalStorage";
import { AnySnapshot, Migrator, PersistedState, VersionCode } from "./types";
import { DEFAULT_VERSION } from "./constants";
import { isSnapshot, isString } from "./utils";

export interface IArgs {
  (name: string, store: any, options?: IOptions): Promise<void>;
}

export interface IOptions {
  version?: VersionCode;
  storage?: any;
  jsonify?: boolean;
  readonly whitelist?: Array<string>;
  readonly blacklist?: Array<string>;
  migrate?: Migrator;
}

export const persist: IArgs = async (name, store, options = {}) => {
  let {
    storage,
    jsonify = true,
    whitelist,
    blacklist,
    version = DEFAULT_VERSION,
    migrate,
  } = options;

  // use AsyncLocalStorage by default (or if localStorage was passed in)
  if (
    typeof window !== "undefined" &&
    typeof window.localStorage !== "undefined" &&
    (!storage || storage === window.localStorage)
  ) {
    storage = AsyncLocalStorage;
  }
  if (!storage) {
    return Promise.reject(
      "localStorage (the default storage engine) is not " +
        "supported in this environment. Please configure a different storage " +
        "engine via the `storage:` option."
    );
  }

  const whitelistSet = new Set(whitelist || []);
  const blacklistSet = new Set(blacklist || []);

  onSnapshot(store, (_snapshot: AnySnapshot) => {
    // need to shallow clone as otherwise properties are non-configurable (https://github.com/agilgur5/mst-persist/pull/21#discussion_r348105595)
    const snapshot = { ..._snapshot };
    Object.keys(snapshot).forEach((key) => {
      if (key === modelTypeKey || key === modelIdKey) {
        return;
      }
      if (whitelist && !whitelistSet.has(key)) {
        delete snapshot[key];
      }
      if (blacklist && blacklistSet.has(key)) {
        delete snapshot[key];
      }
    });

    const state: PersistedState = {
      version: options.version || DEFAULT_VERSION,
      snapshot,
    };

    const data = !jsonify ? state : JSON.stringify(state);
    storage.setItem(name, data);
  });

  const data: object | string = await storage.getItem(name);
  const stateOrSnapshot = !isString(data) ? data : JSON.parse(data);

  // don't apply falsey (which will error), leave store in initial state
  if (!stateOrSnapshot) {
    return;
  }

  let state: PersistedState;

  // account for pre-migration support
  if (isSnapshot(stateOrSnapshot)) {
    state = {
      version: DEFAULT_VERSION,
      snapshot: stateOrSnapshot,
    };
  } else {
    state = stateOrSnapshot;
  }

  if (migrate) {
    state = await migrate(state, version);
  }

  const defaults = getSnapshot(store);

  for (const key of Object.keys(state.snapshot)) {
    if (!(key in defaults)) {
      console.warn(
        `mobx-keystone-persist: persisted store contained non-existent key: ${key}`
      );
      delete state.snapshot[key];
    }
  }

  applySnapshot(store, {
    ...defaults,
    ...state.snapshot,
    $modelId: store.$modelId,
  });
};
