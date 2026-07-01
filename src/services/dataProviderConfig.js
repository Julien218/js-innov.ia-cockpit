export const DATA_PROVIDERS = {
  BASE44: "base44",
  AGENT: "agent",
  SUPABASE: "supabase",
};

export const getDataProvider = () => {
  const fromEnv = import.meta.env.VITE_DATA_PROVIDER;

  const fromStorage =
    typeof window !== "undefined"
      ? window.localStorage.getItem("jsinnovia_data_provider")
      : null;

  return fromStorage || fromEnv || DATA_PROVIDERS.BASE44;
};

export const setDataProvider = (provider) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("jsinnovia_data_provider", provider);
  }
};

export const isBase44Enabled = () => {
  return getDataProvider() === DATA_PROVIDERS.BASE44;
};
