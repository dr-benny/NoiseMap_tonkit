import dynamic from "next/dynamic";

// Disable SSR completely - render everything on client side
const NoiseMapNew = dynamic(() => import("@/components/NoiseMapNew"), {
  ssr: false, // No server-side rendering - everything is client-side
  loading: () => (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-600 font-medium">กำลังโหลดแผนที่...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <NoiseMapNew />;
}

