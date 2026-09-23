// Service worker do Painel Enchentes RS.
// Guarda a página e os últimos dados para o painel abrir mesmo sem sinal.
// Sempre tenta a rede primeiro; o que está salvo só é usado quando a rede falha.
const VERSAO = "painel-v1";
const PAGINA = ["/", "/manifest.webmanifest", "/icone-192.png", "/icone-512.png", "/icone-32.png"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((c) => c.addAll(PAGINA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function redePrimeiro(requisicao, chaveCache) {
  const cache = await caches.open(VERSAO);
  try {
    const resposta = await fetch(requisicao);
    if (resposta.ok) {
      cache.put(chaveCache ?? requisicao, resposta.clone());
      return resposta;
    }
    // Servidor respondeu com erro: se houver dado salvo, ele é mais útil que o erro
    return (await cache.match(chaveCache ?? requisicao)) ?? resposta;
  } catch (erro) {
    const salvo = await cache.match(chaveCache ?? requisicao);
    if (salvo) return salvo;
    throw erro;
  }
}

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // radar, previsão etc. seguem direto

  if (url.pathname.startsWith("/api/")) {
    evento.respondWith(redePrimeiro(req, url.pathname)); // ignora parâmetros na chave
  } else if (req.mode === "navigate") {
    evento.respondWith(redePrimeiro(req, "/"));
  } else if (PAGINA.includes(url.pathname)) {
    evento.respondWith(redePrimeiro(req));
  }
});
