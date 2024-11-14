export interface Promotion {
	medioPago: string;
	titulo: string;
	descripcion: string;
	url: string;
	fecha: string;
	condiciones: string;
}

export interface ScrapingResult {
	success: boolean;
	data?: Promotion[];
	error?: string;
}
