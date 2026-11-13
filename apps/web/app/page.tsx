import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { HomeChat } from './HomeChat';
import { projectBrief } from '@precast/shared';
import { PrdWorkspace } from './PrdWorkspace';

export default function Home() {
  if (projectBrief)
    return (
      <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 p-6 lg:p-10">
        <header className="flex flex-col gap-2">
          <Heading level={1}>{projectBrief.title}</Heading>
          <Text type="supporting">{projectBrief.mission}</Text>
        </header>
        <PrdWorkspace brief={projectBrief} />
      </main>
    );
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
