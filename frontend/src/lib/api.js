import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("garage_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && window.location.pathname !== "/login") {
      localStorage.removeItem("garage_token");
      localStorage.removeItem("garage_user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export function formatEUR(v, locale = "de-DE") {
  const n = Number(v || 0);
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
}

/** Masked price placeholder shown to staff who lack the "prices.*" scope for
 *  a given section.  Owner has full access via role bypass — this only kicks
 *  in for staff members whose permission the owner has withheld. */
export const HIDDEN_PRICE = "€ ••••";

/** One-liner used all over the app: `€ 45,00` for the eyes that may see it,
 *  `€ ••••` for the eyes the owner wants to keep out of the money. */
export function money(value, canSee, locale = "de-DE") {
  return canSee ? formatEUR(value, locale) : HIDDEN_PRICE;
}

export function formatApiError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return err?.message || "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  return String(d);
}
