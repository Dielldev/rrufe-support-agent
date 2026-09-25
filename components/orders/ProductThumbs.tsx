import Image from "next/image";
import type { ProductImage } from "@/lib/engine/types";

export function ProductThumbs({ images, size = 48 }: { images: ProductImage[]; size?: number }) {
  if (!images.length) return null;
  return (
    <div className="flex shrink-0 items-center">
      {images.map((img, i) => (
        <div
          key={img.url}
          title={img.name}
          style={{ width: size, height: size, zIndex: images.length - i }}
          className={`relative overflow-hidden rounded-lg border border-line bg-white p-1 ${i > 0 ? "-ml-3 ring-2 ring-surface" : ""}`}
        >
          <Image src={img.url} alt={img.name} width={size} height={size} className="size-full object-contain" />
        </div>
      ))}
    </div>
  );
}
