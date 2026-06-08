"use client";

import { useState } from "react";

export type GalleryImage = {
  src: string;
  title: string;
  category: string;
};

type GalleryGridProps = {
  images: GalleryImage[];
};

const filters = ["All", "Matchday", "Team Spirit", "Sideline", "Community", "Team Photo"];

export function GalleryGrid({ images }: GalleryGridProps) {
  const [activeFilter, setActiveFilter] = useState("All");
  const [activeImage, setActiveImage] = useState<GalleryImage | null>(null);

  const filteredImages =
    activeFilter === "All"
      ? images
      : images.filter((image) => image.category === activeFilter);

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {filters.map((filter) => (
          <button
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-black transition-colors ${
              activeFilter === filter
                ? "border-[#d8ad45] bg-[#d8ad45] text-[#061426]"
                : "border-white/15 bg-white/[0.04] text-slate-200 hover:border-[#d8ad45]/60"
            }`}
            key={filter}
            onClick={() => setActiveFilter(filter)}
            type="button"
          >
            {filter}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {filteredImages.map((image, index) => (
          <button
            className={`group relative min-h-44 overflow-hidden rounded-lg border border-white/10 bg-white/[0.05] text-left shadow-xl shadow-black/20 ${
              index % 5 === 0 ? "lg:row-span-2 lg:min-h-[360px]" : "lg:min-h-48"
            }`}
            key={image.src}
            onClick={() => setActiveImage(image)}
            type="button"
          >
            <img
              alt={image.title}
              className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
              src={image.src}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#061426]/88 via-[#061426]/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
              <span className="rounded-full bg-[#d8ad45] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#061426]">
                {image.category}
              </span>
              <h3 className="mt-2 text-sm font-black text-white sm:text-base">
                {image.title}
              </h3>
            </div>
          </button>
        ))}
      </div>

      {activeImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#061426]/90 p-4 backdrop-blur"
          role="dialog"
          aria-modal="true"
        >
          <button
            aria-label="Close gallery image"
            className="absolute inset-0"
            onClick={() => setActiveImage(null)}
            type="button"
          />
          <div className="relative w-full max-w-5xl overflow-hidden rounded-lg border border-[#d8ad45]/30 bg-[#061426] shadow-2xl shadow-black/50">
            <button
              className="absolute right-3 top-3 z-10 rounded-full bg-white px-3 py-1.5 text-sm font-black text-[#061426]"
              onClick={() => setActiveImage(null)}
              type="button"
            >
              Close
            </button>
            <img
              alt={activeImage.title}
              className="max-h-[78vh] w-full object-contain"
              src={activeImage.src}
            />
            <div className="border-t border-white/10 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#d8ad45]">
                {activeImage.category}
              </p>
              <h2 className="mt-1 text-xl font-black text-white">{activeImage.title}</h2>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
