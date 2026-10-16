import AudioReactiveOrb from "./components/AudioReactiveOrb";

export default function Home() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#05070a] font-sans text-white">
      <div className="jimmy-scene absolute inset-0" />
      <div className="jimmy-grid absolute inset-0 opacity-20" />
      <div className="jimmy-grid-wide absolute inset-0 opacity-10" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(5,7,10,0.08)_0%,rgba(5,7,10,0.18)_48%,rgba(5,7,10,0.72)_100%)]" />
      <section className="relative z-10 grid min-h-dvh place-items-center px-4 py-8">
        <AudioReactiveOrb />
      </section>
    </main>
  );
}
