import { authSettings } from "./config.mjs";
import { postgresDatabase } from "./database.mjs";
import { accountDocuments } from "./documents.mjs";
import { firebaseAccountProvider } from "./firebase.mjs";
import { googleProvider } from "./google.mjs";
import { accountApi } from "./http.mjs";
import { accountService } from "./service.mjs";
import { accountStore } from "./store.mjs";

export function accountRuntime(root) {
  try {
    const config = authSettings(root);
    if (!config)
      return {
        api: accountApi({ availability: "disabled" }),
        close: async () => {},
      };
    const firebase = firebaseAccountProvider(config.firebase);
    const database = postgresDatabase(config.database);
    const store = accountStore(database, config);
    const service = accountService({
      store,
      password: firebase.provider,
      google: config.google && googleProvider(config.google),
      config,
    });
    return {
      api: accountApi({
        config,
        service,
        documents: accountDocuments(database),
      }),
      close: () => Promise.allSettled([database.close(), firebase.close()]),
    };
  } catch {
    console.warn(
      "Gather accounts are unavailable. Check the server account settings.",
    );
    return {
      api: accountApi({ availability: "unavailable" }),
      close: async () => {},
    };
  }
}
