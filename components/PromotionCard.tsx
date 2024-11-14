import { Promotion } from "@/types/promotion";

interface Props {
	promotion: Promotion;
}

export default function PromotionCard({ promotion }: Props) {
	return (
		<div className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
			<h3 className="text-lg font-semibold mb-2">{promotion.titulo}</h3>
			<p className="text-gray-600 mb-2">{promotion.descripcion}</p>
			<div className="text-sm text-gray-500">
				<p>Fecha: {promotion.fecha}</p>
				<p>Medio de pago: {promotion.medioPago}</p>
				<p>Condiciones: {promotion.condiciones}</p>
				<a
					href={promotion.url}
					target="_blank"
					rel="noopener noreferrer"
					className="text-blue-500 hover:underline"
				>
					Ver promoción
				</a>
			</div>
		</div>
	);
}
