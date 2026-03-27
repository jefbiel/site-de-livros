// Objeto que armazena referências para vários elementos do HTML, facilitando o acesso no código
const elementos = {
  form: document.getElementById("searchForm"),
  input: document.getElementById("searchInput"),
  idioma: document.getElementById("languageSelect"),
  ordenacao: document.getElementById("orderSelect"),
  limite: document.getElementById("limitSelect"),
  genero: document.getElementById("genreSelect"),
  resultados: document.getElementById("resultados"),
  status: document.getElementById("status"),
  chips: Array.from(document.querySelectorAll(".chip")),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  pageInfo: document.getElementById("pageInfo"),
  modalOverlay: document.getElementById("modalOverlay"),
  modalClose: document.getElementById("modalClose"),
  modalCover: document.getElementById("modalCover"),
  modalSource: document.getElementById("modalSource"),
  modalTitle: document.getElementById("modalTitle"),
  modalAuthors: document.getElementById("modalAuthors"),
  modalYear: document.getElementById("modalYear"),
  modalPublisher: document.getElementById("modalPublisher"),
  modalLanguage: document.getElementById("modalLanguage"),
  modalCategories: document.getElementById("modalCategories"),
  modalDescription: document.getElementById("modalDescription"),
  modalPreview: document.getElementById("modalPreview"),
  retryBtn: document.getElementById("retryBtn"),
  historyList: document.getElementById("historyList"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  favoritosList: document.getElementById("favoritosList"),
  favoritesCount: document.getElementById("favoritesCount"),
  clearSearchBtn: document.getElementById("clearSearchBtn")
};

// Objeto que guarda o estado atual da aplicação, como busca, página, favoritos e histórico
const estado = {
  queryAtual: "",
  paginaAtual: 1,
  totalItens: 0,
  buscando: false,
  itensAtuais: [],
  controlador: null,
  fonteAtual: "Google Books",
  favoritos: [],
  historico: []
};

// Chaves usadas para salvar e recuperar dados do localStorage
const STORAGE_KEYS = {
  favoritos: "siteLivrosFavoritos",
  historico: "siteLivrosHistorico"
};

// Atualiza a mensagem de status exibida para o usuário
function atualizarStatus(texto, tipo = "") {
  elementos.status.textContent = texto;
  elementos.status.className = `status ${tipo}`.trim();
}

// Remove espaços extras do texto de busca
function normalizarQuery(texto) {
  return texto.replace(/\s+/g, " ").trim();
}

// Deixa o texto em minúsculo, sem acentos e caracteres especiais, para facilitar comparações
function normalizarTextoComparacao(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cria variações do texto de busca para tentar encontrar mais resultados
function montarVariacoesBusca(query) {
  const semPontuacao = normalizarTextoComparacao(query);
  const compacto = semPontuacao.replace(/\s+/g, " ");

  return Array.from(new Set([query, semPontuacao, compacto].map(normalizarQuery).filter(Boolean)));
}

// Monta a string de busca para a API, incluindo o gênero se selecionado
function montarQueryApi(textoBase, genero) {
  const partes = [];

  if (textoBase) {
    partes.push(textoBase);
  }

  if (genero && genero !== "all") {
    partes.push(`subject:${genero}`);
  }

  return partes.join(" ").trim();
}

// Gera variações de busca para usar nas APIs, considerando o gênero
function montarVariacoesBuscaApi(query, genero) {
  const variacoesTexto = query ? montarVariacoesBusca(query) : [];

  if (variacoesTexto.length === 0 && genero !== "all") {
    return [`subject:${genero}`, genero];
  }

  return variacoesTexto.map((texto) => montarQueryApi(texto, genero));
}

// Calcula a distância de Levenshtein entre dois textos (mede o quão diferentes eles são)
function distanciaLevenshtein(a, b) {
  const origem = normalizarTextoComparacao(a);
  const alvo = normalizarTextoComparacao(b);

  if (!origem) {
    return alvo.length;
  }

  if (!alvo) {
    return origem.length;
  }

  const linhas = origem.length + 1;
  const colunas = alvo.length + 1;
  const matriz = Array.from({ length: linhas }, () => new Array(colunas).fill(0));

  for (let i = 0; i < linhas; i += 1) {
    matriz[i][0] = i;
  }

  for (let j = 0; j < colunas; j += 1) {
    matriz[0][j] = j;
  }

  for (let i = 1; i < linhas; i += 1) {
    for (let j = 1; j < colunas; j += 1) {
      const custo = origem[i - 1] === alvo[j - 1] ? 0 : 1;
      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,
        matriz[i][j - 1] + 1,
        matriz[i - 1][j - 1] + custo
      );
    }
  }

  return matriz[linhas - 1][colunas - 1];
}

// Calcula uma pontuação de proximidade entre a busca do usuário e o livro encontrado
function calcularScoreProximidade(query, item) {
  const queryNorm = normalizarTextoComparacao(query);
  const tituloNorm = normalizarTextoComparacao(item.titulo);
  const autoresNorm = normalizarTextoComparacao(item.autores.join(" "));
  const alvo = `${tituloNorm} ${autoresNorm}`.trim();

  if (!queryNorm || !alvo) {
    return 0;
  }

  let score = 0;

  if (alvo.includes(queryNorm)) {
    score += 140;
  }

  const termos = queryNorm.split(" ").filter((termo) => termo.length > 1);
  termos.forEach((termo) => {
    if (alvo.includes(termo)) {
      score += 24;
    } else {
      const distanciaTermo = distanciaLevenshtein(termo, tituloNorm);
      if (distanciaTermo <= 2) {
        score += 10;
      }
    }
  });

  const distanciaTitulo = distanciaLevenshtein(queryNorm, tituloNorm);
  score += Math.max(0, 80 - distanciaTitulo * 8);

  return score;
}

// Ordena os livros encontrados pela proximidade com a busca do usuário
function ordenarPorProximidade(itens, query) {
  return [...itens]
    .map((item) => ({ item, score: calcularScoreProximidade(query, item) }))
    .sort((a, b) => b.score - a.score)
    .map((entrada) => entrada.item);
}

// Limpa os resultados exibidos na tela
function limparResultados() {
  elementos.resultados.innerHTML = "";
}

// Mostra "skeletons" (efeito de carregamento) enquanto busca os livros
function mostrarSkeleton(quantidade) {
  limparResultados();

  for (let i = 0; i < quantidade; i += 1) {
    const card = document.createElement("article");
    card.className = "livro";
    card.innerHTML = `
      <div class="skeleton skeleton-thumb"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
      <div class="skeleton skeleton-line"></div>
    `;
    elementos.resultados.appendChild(card);
  }
}

// Carrega favoritos e histórico do localStorage (memória do navegador)
function carregarLocalStorage() {
  try {
    const favoritosSalvos = JSON.parse(localStorage.getItem(STORAGE_KEYS.favoritos) || "[]");
    const historicoSalvo = JSON.parse(localStorage.getItem(STORAGE_KEYS.historico) || "[]");

    estado.favoritos = Array.isArray(favoritosSalvos) ? favoritosSalvos : [];
    estado.historico = Array.isArray(historicoSalvo) ? historicoSalvo : [];
  } catch (erro) {
    estado.favoritos = [];
    estado.historico = [];
    console.error("Falha ao carregar dados locais", erro);
  }
}

// Salva a lista de favoritos no localStorage
function salvarFavoritos() {
  localStorage.setItem(STORAGE_KEYS.favoritos, JSON.stringify(estado.favoritos));
}

// Salva o histórico de buscas no localStorage
function salvarHistorico() {
  localStorage.setItem(STORAGE_KEYS.historico, JSON.stringify(estado.historico));
}

// Verifica se um livro já está nos favoritos
function estaFavorito(item) {
  return estado.favoritos.some((fav) => fav.titulo === item.titulo && fav.autores.join(",") === item.autores.join(","));
}

// Adiciona ou remove um livro dos favoritos
function toggleFavorito(item) {
  if (estaFavorito(item)) {
    estado.favoritos = estado.favoritos.filter((fav) => !(fav.titulo === item.titulo && fav.autores.join(",") === item.autores.join(",")));
  } else {
    const favorito = {
      titulo: item.titulo,
      autores: item.autores,
      previewLink: item.previewLink,
      fonte: item.fonte
    };
    estado.favoritos.unshift(favorito);
    estado.favoritos = estado.favoritos.slice(0, 20);
  }

  salvarFavoritos();
  renderizarFavoritos();
  renderizarResultados(estado.itensAtuais);
}

// Adiciona uma busca ao histórico, sem duplicar
function adicionarAoHistorico(query) {
  if (!query) {
    return;
  }

  estado.historico = [query, ...estado.historico.filter((item) => item !== query)].slice(0, 8);
  salvarHistorico();
  renderizarHistorico();
}

// Mostra o histórico de buscas na tela
function renderizarHistorico() {
  elementos.historyList.innerHTML = "";

  if (estado.historico.length === 0) {
    elementos.historyList.innerHTML = '<p class="hint">Nenhuma busca ainda.</p>';
    return;
  }

  estado.historico.forEach((termo) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "history-item";
    botao.textContent = termo;
    botao.dataset.query = termo;
    elementos.historyList.appendChild(botao);
  });
}

// Mostra os livros favoritos na tela
function renderizarFavoritos() {
  elementos.favoritosList.innerHTML = "";
  elementos.favoritesCount.textContent = String(estado.favoritos.length);

  if (estado.favoritos.length === 0) {
    elementos.favoritosList.innerHTML = '<p class="hint">Nenhum favorito salvo.</p>';
    return;
  }

  estado.favoritos.forEach((fav, indice) => {
    const item = document.createElement("span");
    item.className = "favorite-item";

    const link = document.createElement("a");
    link.href = fav.previewLink || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = fav.titulo;
    link.style.color = "inherit";
    link.style.textDecoration = "none";

    if (!fav.previewLink) {
      link.style.pointerEvents = "none";
      link.style.opacity = "0.75";
    }

    const remover = document.createElement("button");
    remover.type = "button";
    remover.className = "remove-fav";
    remover.title = "Remover favorito";
    remover.dataset.index = String(indice);
    remover.textContent = "x";

    item.appendChild(link);
    item.appendChild(remover);
    elementos.favoritosList.appendChild(item);
  });
}

// Transforma o formato do livro vindo do Google Books para o formato usado no site
function normalizarLivroGoogle(item) {
  const info = item.volumeInfo || {};
  return {
    titulo: info.title || "Sem titulo",
    autores: info.authors || ["Autor desconhecido"],
    ano: info.publishedDate ? info.publishedDate.slice(0, 4) : "Ano nao informado",
    editora: info.publisher || "Editora nao informada",
    idioma: (info.language || "--").toUpperCase(),
    categorias: info.categories || ["Sem categoria"],
    descricao: info.description || "Sem descricao disponivel.",
    imagem: info.imageLinks?.thumbnail || "https://via.placeholder.com/220x220?text=Sem+capa",
    previewLink: info.previewLink || "",
    fonte: "Google Books"
  };
}

// Transforma o formato do livro vindo do Open Library para o formato usado no site
function normalizarLivroOpenLibrary(item) {
  const anoValor = item.first_publish_year ? String(item.first_publish_year) : "Ano nao informado";
  const autores = item.author_name && item.author_name.length > 0 ? item.author_name : ["Autor desconhecido"];
  const idioma = item.language && item.language.length > 0 ? item.language[0].toUpperCase() : "--";
  const descricao = item.first_sentence && item.first_sentence.length > 0 ? item.first_sentence[0] : "Sem descricao disponivel.";
  const imagem = item.cover_i
    ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg`
    : "https://via.placeholder.com/220x220?text=Sem+capa";

  return {
    titulo: item.title || "Sem titulo",
    autores,
    ano: anoValor,
    editora: item.publisher && item.publisher.length > 0 ? item.publisher[0] : "Editora nao informada",
    idioma,
    categorias: item.subject && item.subject.length > 0 ? item.subject.slice(0, 3) : ["Sem categoria"],
    descricao,
    imagem,
    previewLink: item.key ? `https://openlibrary.org${item.key}` : "",
    fonte: "Open Library"
  };
}

// Cria o elemento visual (card) de um livro para mostrar na tela
function criarCardLivro(item, indice) {
  const titulo = item.titulo;
  const autores = item.autores.join(", ");
  const ano = item.ano;
  const imagem = item.imagem;

  const card = document.createElement("article");
  card.className = "livro";

  const thumb = document.createElement("img");
  thumb.className = "livro-thumb";
  thumb.src = imagem;
  thumb.alt = `Capa do livro ${titulo}`;

  const conteudo = document.createElement("div");
  conteudo.className = "livro-conteudo";

  const tituloEl = document.createElement("h3");
  tituloEl.textContent = titulo;

  const autoresEl = document.createElement("p");
  autoresEl.className = "meta";
  autoresEl.textContent = `Autor(es): ${autores}`;

  const anoEl = document.createElement("p");
  anoEl.className = "meta";
  anoEl.textContent = `Ano: ${ano}`;

  const acoes = document.createElement("div");
  acoes.className = "livro-acoes";

  const detalhesBtn = document.createElement("button");
  detalhesBtn.className = "detalhes-btn";
  detalhesBtn.type = "button";
  detalhesBtn.dataset.index = String(indice);
  detalhesBtn.textContent = "Detalhes";

  const favBtn = document.createElement("button");
  favBtn.className = "fav-btn";
  favBtn.type = "button";
  favBtn.dataset.index = String(indice);
  favBtn.textContent = estaFavorito(item) ? "Favoritado" : "Favoritar";

  if (estaFavorito(item)) {
    favBtn.classList.add("ativo");
  }

  const preview = document.createElement("a");
  preview.href = item.previewLink || "#";
  preview.target = "_blank";
  preview.rel = "noopener noreferrer";
  preview.textContent = item.previewLink ? "Preview" : "Sem preview";

  if (!item.previewLink) {
    preview.style.opacity = "0.6";
    preview.style.pointerEvents = "none";
  }

  conteudo.appendChild(tituloEl);
  conteudo.appendChild(autoresEl);
  conteudo.appendChild(anoEl);
  acoes.appendChild(detalhesBtn);
  acoes.appendChild(favBtn);
  acoes.appendChild(preview);
  conteudo.appendChild(acoes);

  card.appendChild(thumb);
  card.appendChild(conteudo);

  return card;
}

// Abre o modal (janela) com detalhes do livro
function abrirModal(item) {
  elementos.modalCover.src = item.imagem;
  elementos.modalCover.alt = `Capa do livro ${item.titulo}`;
  elementos.modalSource.textContent = `Fonte: ${item.fonte}`;
  elementos.modalTitle.textContent = item.titulo;
  elementos.modalAuthors.textContent = `Autor(es): ${item.autores.join(", ")}`;
  elementos.modalYear.textContent = `Ano: ${item.ano}`;
  elementos.modalPublisher.textContent = `Editora: ${item.editora}`;
  elementos.modalLanguage.textContent = `Idioma: ${item.idioma}`;
  elementos.modalCategories.textContent = `Categorias: ${item.categorias.join(", ")}`;
  elementos.modalDescription.textContent = item.descricao;

  if (item.previewLink) {
    elementos.modalPreview.href = item.previewLink;
    elementos.modalPreview.textContent = "Abrir pagina do livro";
    elementos.modalPreview.classList.remove("disabled");
  } else {
    elementos.modalPreview.href = "#";
    elementos.modalPreview.textContent = "Sem pagina disponivel";
    elementos.modalPreview.classList.add("disabled");
  }

  elementos.modalOverlay.hidden = false;
  document.body.style.overflow = "hidden";
}

// Fecha o modal de detalhes do livro
function fecharModal() {
  elementos.modalOverlay.hidden = true;
  document.body.style.overflow = "";
}

// Faz uma busca de livros na API do Google Books
async function buscarNoGoogleBooks(params) {
  const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
  const resposta = await fetch(url, { signal: estado.controlador.signal });

  if (!resposta.ok) {
    throw new Error(`Google Books retornou ${resposta.status}`);
  }

  const data = await resposta.json();
  return {
    itens: (data.items || []).map(normalizarLivroGoogle),
    totalItens: Number(data.totalItems || 0),
    fonte: "Google Books"
  };
}

// Tenta buscar livros no Google Books usando várias variações da busca
async function buscarNoGoogleBooksComVariacoes(variacoes, paramsBase) {
  for (const termo of variacoes) {
    const params = new URLSearchParams(paramsBase.toString());
    params.set("q", termo);

    const retorno = await buscarNoGoogleBooks(params);

    if (retorno.itens.length > 0) {
      return {
        ...retorno,
        queryUtilizada: termo,
        aproximada: normalizarTextoComparacao(termo) !== normalizarTextoComparacao(variacoes[0])
      };
    }
  }

  return {
    itens: [],
    totalItens: 0,
    fonte: "Google Books",
    queryUtilizada: variacoes[0],
    aproximada: false
  };
}

// Faz uma busca de livros na API do Open Library
async function buscarNoOpenLibrary(query, itensPorPagina) {
  const pagina = Math.max(1, estado.paginaAtual);
  const params = new URLSearchParams({
    q: query,
    page: String(pagina),
    limit: String(itensPorPagina)
  });

  const url = `https://openlibrary.org/search.json?${params.toString()}`;
  const resposta = await fetch(url, { signal: estado.controlador.signal });

  if (!resposta.ok) {
    throw new Error(`Open Library retornou ${resposta.status}`);
  }

  const data = await resposta.json();
  return {
    itens: (data.docs || []).map(normalizarLivroOpenLibrary),
    totalItens: Number(data.numFound || 0),
    fonte: "Open Library"
  };
}

// Tenta buscar livros no Open Library usando várias variações da busca
async function buscarNoOpenLibraryComVariacoes(variacoes, itensPorPagina) {
  for (const termo of variacoes) {
    const retorno = await buscarNoOpenLibrary(termo, itensPorPagina);

    if (retorno.itens.length > 0) {
      return {
        ...retorno,
        queryUtilizada: termo,
        aproximada: normalizarTextoComparacao(termo) !== normalizarTextoComparacao(variacoes[0])
      };
    }
  }

  return {
    itens: [],
    totalItens: 0,
    fonte: "Open Library",
    queryUtilizada: variacoes[0],
    aproximada: false
  };
}

// Retorna uma mensagem de erro amigável para o usuário
function obterMensagemErro(erro) {
  if (erro.name === "AbortError") {
    return "Busca anterior cancelada para iniciar a nova pesquisa.";
  }

  if (erro.message.includes("Failed to fetch")) {
    return "Falha de rede. Verifique sua conexao e tente novamente.";
  }

  return "Nao foi possivel carregar os livros agora.";
}

// Mostra os livros encontrados na tela
function renderizarResultados(itens) {
  estado.itensAtuais = itens;
  limparResultados();

  itens.forEach((item, indice) => {
    elementos.resultados.appendChild(criarCardLivro(item, indice));
  });
}

// Atualiza a exibição dos botões e informações de paginação
function atualizarPaginacao() {
  const itensPorPagina = Number(elementos.limite.value);
  const totalPaginas = Math.max(1, Math.ceil(estado.totalItens / itensPorPagina));

  elementos.pageInfo.textContent = `Pagina ${estado.paginaAtual} de ${totalPaginas}`;
  elementos.prevBtn.disabled = estado.paginaAtual <= 1 || estado.buscando;
  elementos.nextBtn.disabled = estado.paginaAtual >= totalPaginas || estado.buscando;
}

// Função principal que faz a busca dos livros, trata erros e atualiza a tela
async function buscarLivros() {
  const query = normalizarQuery(estado.queryAtual);
  const genero = elementos.genero.value;
  const temGenero = genero !== "all";

  if (!query && !temGenero) {
    limparResultados();
    estado.totalItens = 0;
    atualizarPaginacao();
    atualizarStatus("Digite algo para pesquisar ou escolha um genero.", "error");
    return;
  }

  if (query && query.length < 2) {
    limparResultados();
    estado.totalItens = 0;
    atualizarPaginacao();
    atualizarStatus("Digite pelo menos 2 caracteres para buscar.", "error");
    return;
  }

  const idioma = elementos.idioma.value;
  const ordenacao = elementos.ordenacao.value;
  const itensPorPagina = Number(elementos.limite.value);
  const startIndex = (estado.paginaAtual - 1) * itensPorPagina;
  const variacoesBusca = montarVariacoesBuscaApi(query, genero);
  const termoRelevancia = query || genero;

  const params = new URLSearchParams({
    q: variacoesBusca[0],
    startIndex: String(startIndex),
    maxResults: String(itensPorPagina),
    orderBy: ordenacao,
    printType: "books"
  });

  if (idioma !== "all") {
    params.set("langRestrict", idioma);
  }

  try {
    if (estado.controlador) {
      estado.controlador.abort();
    }

    estado.controlador = new AbortController();
    estado.buscando = true;
    atualizarPaginacao();
    elementos.retryBtn.hidden = true;
    atualizarStatus("Buscando livros...");
    mostrarSkeleton(itensPorPagina);

    let retorno = await buscarNoGoogleBooksComVariacoes(variacoesBusca, params);

    if (retorno.itens.length === 0 && estado.paginaAtual === 1) {
      atualizarStatus("Google Books sem resultados, buscando em outra fonte...");
      retorno = await buscarNoOpenLibraryComVariacoes(variacoesBusca, itensPorPagina);
    }

    retorno.itens = ordenarPorProximidade(retorno.itens, termoRelevancia);
    estado.totalItens = retorno.totalItens;
    estado.fonteAtual = retorno.fonte;

    if (retorno.itens.length === 0) {
      estado.itensAtuais = [];
      limparResultados();
      atualizarStatus("Nenhum livro encontrado para essa busca.", "error");
      atualizarPaginacao();
      return;
    }

    renderizarResultados(retorno.itens);
    adicionarAoHistorico(query || `Genero: ${genero}`);

    const textoAproximacao = retorno.aproximada ? " Busca aproximada ativada." : "";
    atualizarStatus(`Exibindo ${retorno.itens.length} livro(s) via ${retorno.fonte}.${textoAproximacao}`, "success");
    atualizarPaginacao();
  } catch (erro) {
    if (erro.name === "AbortError") {
      return;
    }

    try {
      atualizarStatus("Google Books indisponivel, tentando Open Library...");
      if (estado.controlador) {
        estado.controlador.abort();
      }

      estado.controlador = new AbortController();
      const retornoFallback = await buscarNoOpenLibraryComVariacoes(variacoesBusca, itensPorPagina);
      retornoFallback.itens = ordenarPorProximidade(retornoFallback.itens, termoRelevancia);
      estado.totalItens = retornoFallback.totalItens;
      estado.fonteAtual = retornoFallback.fonte;

      if (retornoFallback.itens.length === 0) {
        estado.itensAtuais = [];
        limparResultados();
        atualizarStatus("Nenhum livro encontrado na busca atual.", "error");
        atualizarPaginacao();
        return;
      }

      renderizarResultados(retornoFallback.itens);
      adicionarAoHistorico(query || `Genero: ${genero}`);
  const textoAproximacao = retornoFallback.aproximada ? " Busca aproximada ativada." : "";
  atualizarStatus(`Exibindo ${retornoFallback.itens.length} livro(s) via Open Library.${textoAproximacao}`, "success");
      atualizarPaginacao();
    } catch (erroFallback) {
      limparResultados();
      estado.itensAtuais = [];
      estado.totalItens = 0;
      atualizarPaginacao();
      const mensagem = obterMensagemErro(erroFallback);
      atualizarStatus(`${mensagem} Tente novamente em alguns segundos.`, "error");
      elementos.retryBtn.hidden = false;
      console.error(erro);
      console.error(erroFallback);
    }
  } finally {
    estado.buscando = false;
    atualizarPaginacao();
  }
}

// Adiciona todos os "event listeners" (ações ao clicar, digitar, etc.) nos elementos da página
function iniciarEventos() {
  elementos.form.addEventListener("submit", (event) => {
    event.preventDefault();
    estado.queryAtual = elementos.input.value;
    estado.paginaAtual = 1;
    buscarLivros();
  });

  elementos.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      estado.queryAtual = elementos.input.value;
      estado.paginaAtual = 1;
      buscarLivros();
    }
  });

  elementos.prevBtn.addEventListener("click", () => {
    if (estado.paginaAtual > 1) {
      estado.paginaAtual -= 1;
      buscarLivros();
    }
  });

  elementos.nextBtn.addEventListener("click", () => {
    const totalPaginas = Math.max(1, Math.ceil(estado.totalItens / Number(elementos.limite.value)));
    if (estado.paginaAtual < totalPaginas) {
      estado.paginaAtual += 1;
      buscarLivros();
    }
  });

  elementos.limite.addEventListener("change", () => {
    estado.paginaAtual = 1;
    if (estado.queryAtual.trim()) {
      buscarLivros();
    } else {
      atualizarPaginacao();
    }
  });

  elementos.idioma.addEventListener("change", () => {
    estado.paginaAtual = 1;
    if (estado.queryAtual.trim()) {
      buscarLivros();
    }
  });

  elementos.ordenacao.addEventListener("change", () => {
    estado.paginaAtual = 1;
    if (estado.queryAtual.trim()) {
      buscarLivros();
    }
  });

  elementos.genero.addEventListener("change", () => {
    estado.paginaAtual = 1;
    if (estado.queryAtual.trim() || elementos.genero.value !== "all") {
      buscarLivros();
    }
  });

  elementos.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const query = chip.dataset.query || "";
      elementos.input.value = query;
      estado.queryAtual = query;
      estado.paginaAtual = 1;
      buscarLivros();
    });
  });

  elementos.resultados.addEventListener("click", (event) => {
    const botao = event.target.closest(".detalhes-btn");
    const botaoFav = event.target.closest(".fav-btn");

    if (botaoFav) {
      const indiceFav = Number(botaoFav.dataset.index);
      const livroFav = estado.itensAtuais[indiceFav];

      if (livroFav) {
        toggleFavorito(livroFav);
      }

      return;
    }

    if (!botao) {
      return;
    }

    const indice = Number(botao.dataset.index);
    const livro = estado.itensAtuais[indice];

    if (livro) {
      abrirModal(livro);
    }
  });

  elementos.modalClose.addEventListener("click", fecharModal);

  elementos.modalOverlay.addEventListener("click", (event) => {
    if (event.target === elementos.modalOverlay) {
      fecharModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elementos.modalOverlay.hidden) {
      fecharModal();
    }
  });

  elementos.retryBtn.addEventListener("click", () => {
    if (estado.queryAtual.trim()) {
      buscarLivros();
    }
  });

  elementos.historyList.addEventListener("click", (event) => {
    const botao = event.target.closest(".history-item");

    if (!botao) {
      return;
    }

    const query = botao.dataset.query || "";
    elementos.input.value = query;
    estado.queryAtual = query;
    estado.paginaAtual = 1;
    buscarLivros();
  });

  elementos.clearHistoryBtn.addEventListener("click", () => {
    estado.historico = [];
    salvarHistorico();
    renderizarHistorico();
    atualizarStatus("Historico limpo.", "success");
  });

  elementos.clearSearchBtn.addEventListener("click", () => {
    elementos.input.value = "";
    estado.queryAtual = "";
    estado.totalItens = 0;
    limparResultados();
    atualizarPaginacao();
    atualizarStatus("Campo de busca limpo.");
    elementos.input.focus();
  });

  elementos.favoritosList.addEventListener("click", (event) => {
    const remover = event.target.closest(".remove-fav");

    if (!remover) {
      return;
    }

    const indice = Number(remover.dataset.index);
    if (!Number.isNaN(indice)) {
      estado.favoritos.splice(indice, 1);
      salvarFavoritos();
      renderizarFavoritos();
      renderizarResultados(estado.itensAtuais);
    }
  });
}

// Inicialização do site: carrega dados, mostra histórico/favoritos, ativa eventos e mostra mensagem inicial
carregarLocalStorage();
renderizarHistorico();
renderizarFavoritos();
iniciarEventos();
atualizarPaginacao();
atualizarStatus("Digite um tema para buscar livros na API Google Books.");
