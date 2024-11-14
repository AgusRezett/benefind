"use client";

import { useEffect, useState } from "react";
import { Promotion } from "@/types/promotion";
import PromotionList from "./PromotionList";
import UrlInput from "./UrlInput";

const INITIAL_URLS = [
	// "https://www.mercadopago.com.ar/promociones",
	// "https://www.jumbo.com.ar/descuentos-del-dia?type=por-dia&day=3",
	"https://diaonline.supermercadosdia.com.ar/medios-de-pago-y-promociones",
];

export default function PromotionScraper() {
	const [promotions, setPromotions] = useState<Promotion[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchPromotions = async (urls: string[]) => {
		setLoading(true);
		setError(null);

		try {
			const response = await fetch("/api/scrape-promotions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ urls }),
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || "Error al obtener promociones");
			}

			setPromotions(data.promotions);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Error desconocido");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchPromotions(INITIAL_URLS);
	}, []);

	return (
		<div className="max-w-4xl mx-auto p-4">
			<h1 className="text-2xl font-bold mb-4">Buscador de Promociones</h1>
			<UrlInput onSubmit={fetchPromotions} disabled={loading} />

			{error && (
				<div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded my-4">
					{error}
				</div>
			)}

			{loading ? (
				<div className="text-center py-4">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
					<p className="mt-2">Buscando promociones...</p>
				</div>
			) : (
				<PromotionList promotions={promotions} />
			)}
		</div>
	);
}
