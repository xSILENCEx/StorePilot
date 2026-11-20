"use client";
import Link from "next/link";
import { createContext, useContext, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AppShell,
  Burger,
  Group,
  Text,
  ThemeIcon,
  NavLink,
  Stack,
  Button,
  Container,
  Box,
} from "@mantine/core";
import { Layers, Settings2, LogOut, Activity } from "lucide-react";
import { TaskDrawer } from "./task-drawer";
type NavigationDetails = {
  title?: string;
  appId?: string;
  canSignOut: boolean;
};
const NavigationContext = createContext<
  ((value: NavigationDetails) => void) | null
>(null);

export function useWorkspaceNavigation(
  title: string | undefined,
  appId: string | undefined,
  canSignOut: boolean,
) {
  const update = useContext(NavigationContext);
  useLayoutEffect(() => {
    update?.({ title, appId, canSignOut });
  }, [update, title, appId, canSignOut]);
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const settings = usePathname() === "/settings";
  const [details, setDetails] = useState<NavigationDetails>({
    canSignOut: true,
  });
  const title = settings ? "连接与模型" : (details.title ?? "应用管理");
  const [dismissed, setDismissed] = useState(false);
  function closeNavigation() {
    setOpened(false);
    setDismissed(true);
  }
  const [opened, setOpened] = useState(false);
  const [tasks, setTasks] = useState(false);
  return (
    <AppShell
      header={{ height: 70 }}
      navbar={{ width: 64, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Group gap="sm">
            <Burger
              opened={opened}
              onClick={() => setOpened(!opened)}
              hiddenFrom="sm"
              size="sm"
              aria-label="切换导航"
            />
            <Link href="/" className="brand">
              <Group gap="xs">
                <ThemeIcon size={34} radius="md">
                  <Layers size={20} />
                </ThemeIcon>
                <Text fw={750} size="lg" c="dark.8">
                  StorePilot
                </Text>
              </Group>
            </Link>
            <Text c="dimmed" size="sm" visibleFrom="sm" ml="xl">
              工作空间 / {title}
            </Text>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar
        className="workspace-nav"
        py="md"
        px="xs"
        data-dismissed={dismissed || undefined}
        onPointerLeave={() => setDismissed(false)}
        onFocusCapture={() => setDismissed(false)}
      >
        <Stack gap={6} h="100%">
          <NavLink
            onNavigate={closeNavigation}
            component={Link}
            href="/"
            active={!settings}
            label="应用管理"
            leftSection={<Layers size={18} />}
          />
          <NavLink
            onNavigate={closeNavigation}
            component={Link}
            href="/settings"
            active={settings}
            label="连接与模型"
            leftSection={<Settings2 size={18} />}
          />
          <NavLink
            component="button"
            label="任务记录"
            leftSection={<Activity size={18} />}
            onClick={() => {
              setTasks(true);
              closeNavigation();
            }}
          />
          <Box style={{ flex: 1 }} />
          <Button
            variant="subtle"
            color="gray"
            justify="start"
            px="sm"
            leftSection={<LogOut size={16} />}
            disabled={!settings && !details.canSignOut}
            onClick={async () => {
              const r = await fetch("/api/auth/sign-out", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              });
              if (r.ok) location.href = "/login";
            }}
          >
            退出登录
          </Button>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Container size="xl" className="workspace-content">
          <NavigationContext.Provider value={setDetails}>
            {children}
          </NavigationContext.Provider>
        </Container>
      </AppShell.Main>
      <TaskDrawer
        opened={tasks}
        onClose={() => setTasks(false)}
        appId={settings ? undefined : details.appId}
      />
    </AppShell>
  );
}
