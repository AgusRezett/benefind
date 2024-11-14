import { Promotion } from "@/types/promotion";
import PromotionCard from "./PromotionCard";

interface Props {
	promotions: Promotion[];
}

export default function PromotionList({ promotions }: Props) {
	if (!promotions.length) {
		return <p className="text-center py-4">No hay promociones disponibles</p>;
	}

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
			{promotions.map((promotion, index) => (
				<PromotionCard key={index} promotion={promotion} />
			))}
		</div>
	);
}
