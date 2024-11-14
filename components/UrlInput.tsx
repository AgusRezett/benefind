import { useState } from "react";

interface Props {
	onSubmit: (urls: string[]) => void;
	disabled?: boolean;
}

export default function UrlInput({ onSubmit, disabled }: Props) {
	const [urlInput, setUrlInput] = useState("");

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const urls = urlInput.split("\n").filter((url) => url.trim());
		onSubmit(urls);
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<textarea
				value={urlInput}
				onChange={(e) => setUrlInput(e.target.value)}
				placeholder="Ingresa las URLs (una por línea)"
				className="w-full h-32 p-2 border rounded"
				disabled={disabled}
			/>
			<button
				type="submit"
				disabled={disabled || !urlInput.trim()}
				className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300"
			>
				Buscar Promociones
			</button>
		</form>
	);
}
