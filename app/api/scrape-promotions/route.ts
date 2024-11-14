import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import puppeteer, { Browser, Page } from "puppeteer";
import OpenAI from "openai";
import { ScrapingResult, Promotion } from "@/types/promotion";

// Configuración de OpenAI
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY || "",
});

// Validación del esquema de entrada
const urlSchema = z.object({
	urls: z
		.array(z.string().url())
		.min(1, "Se requiere al menos una URL")
		.max(10, "Máximo 10 URLs permitidas"),
});

// Tipos de error personalizados
class SelectorGenerationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SelectorGenerationError";
	}
}

class ScrapingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ScrapingError";
	}
}

// Función para logging con timestamp
const logger = {
	info: (message: string, data?: any) => {
		console.log(`[${new Date().toISOString()}] INFO: ${message}`, data || "");
	},
	error: (message: string, error?: any) => {
		console.error(
			`[${new Date().toISOString()}] ERROR: ${message}`,
			error || ""
		);
	},
	debug: (message: string, data?: any) => {
		if (process.env.NODE_ENV === "development") {
			console.debug(
				`[${new Date().toISOString()}] DEBUG: ${message}`,
				data || ""
			);
		}
	},
};

async function generateSelector(html: string): Promise<string> {
	logger.debug("Generando selectores para HTML", { htmlLength: html.length });

	try {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error("OPENAI_API_KEY no está configurada");
		}

		const response = await openai.chat.completions.create({
			model: "gpt-3.5-turbo",
			messages: [
				{
					role: "system",
					content:
						"Genera selectores CSS precisos y específicos para elementos de promoción. Responde solo con JSON válido.",
				},
				{
					role: "user",
					content: `Analiza este HTML y devuelve selectores CSS para elementos de promoción, deberás retornar
										solamente el contenido asociado a promociones y descuentos, no necesariamente a aquellos
										elementos con palabras relacionadas, analiza el contexto del elemento, también deberás
										evitar promociones o descuentos duplicados. Responde SOLO con JSON válido en este formato
										exacto: 
										
										{"medioPago":"selector","titulo":"selector","descripcion":"selector","fecha":"selector","condiciones":"selector"}. 
										
										HTML: ${html}`,
				},
			],
			temperature: 0.3,
			// max_tokens: 150,
		});

		const content = response.choices[0]?.message?.content;
		if (!content) {
			throw new SelectorGenerationError("OpenAI no generó ningún selector");
		}

		// Validar que el contenido sea JSON válido
		try {
			JSON.parse(content);
			return content;
		} catch {
			throw new SelectorGenerationError("Respuesta no es JSON válido");
		}
	} catch (error) {
		logger.error("Error al generar selectores", error);
		throw new SelectorGenerationError(
			error instanceof Error ? error.message : "Error desconocido"
		);
	}
}

async function setupPuppeteer(): Promise<Browser> {
	try {
		return await puppeteer.launch({
			// @ts-ignore
			headless: "new",
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
			timeout: 30000,
		});
	} catch (error) {
		logger.error("Error al inicializar Puppeteer", error);
		throw new Error("No se pudo inicializar el navegador");
	}
}

async function sanitizeHTML(html: string): Promise<string> {
	// Eliminar elementos no relevantes
	return (
		html
			// Eliminar head y su contenido
			.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, "")
			// Eliminar scripts
			.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
			// Eliminar estilos
			.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
			// Eliminar comentarios
			.replace(/<!--[\s\S]*?-->/g, "")
			// Eliminar footer
			.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
			// Eliminar elementos de navegación
			.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
			// Eliminar formularios
			.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
			// Eliminar iframes
			.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
			// Eliminar atributos no necesarios
			.replace(
				/\s(onclick|onload|onerror|id|class|style|data-.*?)="[^"]*"/gi,
				""
			)
			// Eliminar líneas vacías y espacios extra
			.replace(/^\s*[\r\n]/gm, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

const MAX_CHUNK_LENGTH = 15000;
const MAX_REQUESTS_PER_MINUTE = 3; // Ajustar según el plan de OpenAI
const RATE_LIMIT_DELAY = 20000; // 20 segundos de espera entre chunks

// Función para dividir el HTML en chunks manejables
async function splitHTMLIntoChunks(html: string): Promise<string[]> {
	const chunks: string[] = [];
	let remainingHtml = html;

	while (remainingHtml.length > 0) {
		if (remainingHtml.length <= MAX_CHUNK_LENGTH) {
			chunks.push(remainingHtml);
			break;
		}

		// Buscar un punto seguro para dividir (al final de un elemento)
		let splitIndex = remainingHtml.lastIndexOf("</div>", MAX_CHUNK_LENGTH);
		if (splitIndex === -1) {
			splitIndex = MAX_CHUNK_LENGTH;
		}

		chunks.push(remainingHtml.slice(0, splitIndex + 6)); // +6 para incluir '</div>'
		remainingHtml = remainingHtml.slice(splitIndex + 6);
	}

	logger.debug("HTML dividido en chunks", {
		totalChunks: chunks.length,
		chunkSizes: chunks.map((c) => c.length),
	});

	return chunks;
}

// Función para procesar chunks con rate limiting
async function processHTMLChunks(
	chunks: string[]
): Promise<Record<string, string>[]> {
	const results: Record<string, string>[] = [];
	let requestCount = 0;

	for (let i = 0; i < chunks.length; i++) {
		if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
			logger.info(
				`Esperando ${RATE_LIMIT_DELAY}ms para respetar rate limits...`
			);
			await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
			requestCount = 0;
		}

		try {
			const selectorsJson = await generateSelector(chunks[i]);
			const selectors = JSON.parse(selectorsJson);
			results.push(selectors);
			requestCount++;
		} catch (error) {
			logger.error(`Error procesando chunk ${i + 1}/${chunks.length}`, error);
		}
	}

	return results;
}

// Función para combinar selectores de múltiples chunks
function combineSelectors(
	selectorsList: Record<string, string>[]
): Record<string, string> {
	const combined: Record<string, string> = {};
	const allKeys = [
		"medioPago",
		"titulo",
		"descripcion",
		"fecha",
		"condiciones",
	];

	allKeys.forEach((key) => {
		const selectors = selectorsList.map((s) => s[key]).filter(Boolean);

		combined[key] = selectors.join(", ");
	});

	return combined;
}

async function scrapeUrl(url: string): Promise<ScrapingResult> {
	logger.info(`Iniciando scraping de URL: ${url}`);
	let browser: Browser | null = null;
	let page: Page | null = null;

	try {
		browser = await setupPuppeteer();
		page = await browser.newPage();

		// Configuración de Puppeteer...
		await page.setDefaultNavigationTimeout(30000);
		await page.setRequestInterception(true);

		page.on("request", (request) => {
			if (
				["image", "stylesheet", "font", "media"].includes(
					request.resourceType()
				)
			) {
				request.abort();
			} else {
				request.continue();
			}
		});

		await page.goto(url, { waitUntil: "networkidle0" });

		// Obtener y sanitizar HTML
		const bodyHTML = await page.evaluate(() => document.body.outerHTML);
		const sanitizedHTML = await sanitizeHTML(bodyHTML);

		// Dividir HTML en chunks y procesarlos
		const chunks = await splitHTMLIntoChunks(sanitizedHTML);
		const selectorsList = await processHTMLChunks(chunks);
		const combinedSelectors = combineSelectors(selectorsList);

		// Extraer datos usando los selectores combinados
		const promotions = await page.evaluate((selectors) => {
			const findElements = (selector: string) => {
				if (!selector) return [];
				try {
					return Array.from(document.querySelectorAll(selector)).map(
						(el) => el.textContent?.trim() || ""
					);
				} catch {
					return [];
				}
			};

			const titulos = findElements(selectors.titulo);
			const descripciones = findElements(selectors.descripcion);
			const fechas = findElements(selectors.fecha);
			const condiciones = findElements(selectors.condiciones);
			const mediosPago = findElements(selectors.medioPago);

			return titulos
				.map((titulo, index) => ({
					medioPago: mediosPago[index] || "",
					titulo,
					descripcion: descripciones[index] || "",
					url: window.location.href,
					fecha: fechas[index] || "",
					condiciones: condiciones[index] || "",
				}))
				.filter((promo) => promo.titulo || promo.descripcion);
		}, combinedSelectors);

		logger.info(`Scraping completado para ${url}`, {
			promocionesEncontradas: promotions.length,
		});

		return {
			success: true,
			data: promotions,
		};
	} catch (error) {
		logger.error(`Error en scraping de ${url}`, error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Error desconocido",
		};
	} finally {
		if (page)
			await page
				.close()
				.catch((e) => logger.error("Error al cerrar página", e));
		if (browser)
			await browser
				.close()
				.catch((e) => logger.error("Error al cerrar navegador", e));
	}
}

export async function POST(req: NextRequest): Promise<NextResponse> {
	const startTime = Date.now();
	logger.info("Iniciando solicitud POST");

	try {
		const body = await req.json();
		logger.debug("Body recibido", body);

		const { urls } = urlSchema.parse(body);
		logger.info(`Procesando ${urls.length} URLs`);

		const results = await Promise.all(urls.map((url) => scrapeUrl(url)));

		const promotions = results
			.filter((result) => result.success)
			.flatMap((result) => result.data || []);

		const errors = results
			.filter((result) => !result.success)
			.map((result) => result.error);

		const executionTime = Date.now() - startTime;
		logger.info("Solicitud completada", {
			executionTime,
			promocionesEncontradas: promotions.length,
			errores: errors.length,
		});

		return NextResponse.json(
			{
				promotions,
				errors: errors.length > 0 ? errors : undefined,
				executionTime,
			},
			{ status: 200 }
		);
	} catch (error) {
		logger.error("Error en el endpoint", error);

		if (error instanceof z.ZodError) {
			return NextResponse.json(
				{
					error: "Error de validación",
					details: error.errors,
				},
				{ status: 400 }
			);
		}

		if (error instanceof SelectorGenerationError) {
			return NextResponse.json(
				{
					error: "Error al generar selectores",
					message: error.message,
				},
				{ status: 422 }
			);
		}

		return NextResponse.json(
			{
				error: "Error interno del servidor",
				message: error instanceof Error ? error.message : "Error desconocido",
			},
			{ status: 500 }
		);
	}
}
