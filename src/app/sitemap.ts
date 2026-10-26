import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return ["", "/features", "/pricing", "/how-it-works", "/methodology", "/about", "/faq", "/contact", "/signup", "/login", "/privacy", "/terms", "/risk"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: p === "" ? "daily" : "monthly",
  }));
}
