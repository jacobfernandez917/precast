import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { HomeChat } from './HomeChat';

export default function Home() {
  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-2">
        <Heading level={1}>Precast</Heading>
        <Text type="supporting">Chat with your agent. It remembers you across devices.</Text>
      </div>
      <HomeChat />
    </main>
  );
}
