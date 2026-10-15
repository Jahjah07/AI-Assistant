import AudioReactiveOrb from "./components/AudioReactiveOrb";

export default function Home() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#05070a] font-sans text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(47,162,190,0.2),transparent_34%),linear-gradient(135deg,#05070a_0%,#0c1014_50%,#15110c_100%)]" />
      <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(125,232,255,0.28)_1px,transparent_1px),linear-gradient(90deg,rgba(125,232,255,0.28)_1px,transparent_1px)] bg-[size:42px_42px]" />
      <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(255,214,112,0.16)_2px,transparent_2px),linear-gradient(90deg,rgba(255,214,112,0.16)_2px,transparent_2px)] bg-[size:168px_168px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(5,7,10,0.08)_0%,rgba(5,7,10,0.18)_48%,rgba(5,7,10,0.72)_100%)]" />
      <section className="relative z-10 grid min-h-dvh place-items-center px-4 py-8">
        <AudioReactiveOrb />
      </section>
    </main>
  );
}
