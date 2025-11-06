"use client";

import dynamic from "next/dynamic";

const NoiseMapNew = dynamic(() => import("@/components/NoiseMapNew"), {
  ssr: false,
});

export default function Home() {
  return <NoiseMapNew />;
}

