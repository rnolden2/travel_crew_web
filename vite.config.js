import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";

const pageRoutes = new Map([
  ["/", "/pages/index.html"],
  ["/travelchain", "/pages/travelchain.html"],
  ["/travelchain.html", "/pages/travelchain.html"],
  ["/privacypolicy", "/pages/privacypolicy.html"],
  ["/privacypolicy.html", "/pages/privacypolicy.html"],
  ["/terms&conditions", "/pages/terms&conditions.html"],
  ["/terms&conditions.html", "/pages/terms&conditions.html"],
]);

function rewritePageRequest(req) {
  const [url, query] = req.url?.split("?") || [];
  if (!url) return;

  if (url.startsWith("/trip/")) {
    req.url = "/pages/trip.html" + (query ? `?${query}` : "");
    return;
  }

  const page = pageRoutes.get(url);
  if (page) {
    req.url = page + (query ? `?${query}` : "");
  }
}

function pageRouteMiddleware() {
  return {
    name: "travel-crew-page-routes",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewritePageRequest(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewritePageRequest(req);
        next();
      });
    },
  };
}

export default defineConfig(({mode}) => {
 const env = loadEnv(mode, process.cwd(), "");
 const proxy = {"/api": {target: env.WEB_API_TARGET || "http://127.0.0.1:8080"}};
 return {
  plugins: [pageRouteMiddleware()],
  server: {proxy},
  preview: {proxy},
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "pages/index.html"),
        trip: resolve(__dirname, "pages/trip.html"),
        travelchain: resolve(__dirname, "pages/travelchain.html"),
        privacypolicy: resolve(__dirname, "pages/privacypolicy.html"),
        "terms&conditions": resolve(__dirname, "pages/terms&conditions.html"),
        404: resolve(__dirname, "pages/404.html"),
      },
    },
  },
 };
});
