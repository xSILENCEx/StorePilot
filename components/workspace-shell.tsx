"use client";
import { useWorkspace } from "../lib/use-workspace";
import Link from "next/link";
import { createContext, useContext, useLayoutEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  Alert,
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
const DraftContext = createContext<ReturnType<typeof useWorkspace> | null>(
  null,
);
export function useWorkspaceDrafts() {
  const value = useContext(DraftContext);
  if (!value) throw new Error("WorkspaceShell is required");
  return value;
}
export function WorkspaceLink({
  href,
  onNavigate,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  const { saved, flush } = useWorkspaceDrafts();
  const router = useRouter();
  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        onNavigate?.(event);
        if (!saved) {
          event.preventDefault();
          void flush().then((ok) => {
            if (ok) router.push(href);
          });
        }
      }}
    />
  );
}
type NavigationDetails = {
  title?: string;
  appId?: string;
};
const NavigationContext = createContext<
  ((value: NavigationDetails) => void) | null
>(null);

export function useWorkspaceNavigation(
  title: string | undefined,
  appId: string | undefined,
) {
  const update = useContext(NavigationContext);
  useLayoutEffect(() => {
    update?.({ title, appId });
  }, [update, title, appId]);
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [saveError, setSaveError] = useState("");
  const workspace = useWorkspace(setSaveError);
  const settings = usePathname() === "/settings";
  const [details, setDetails] = useState<NavigationDetails>({});
  const title = settings ? "连接与模型" : (details.title ?? "应用管理");
  const [dismissed, setDismissed] = useState(false);
  function closeNavigation() {
    setOpened(false);
    setDismissed(true);
  }
  const [opened, setOpened] = useState(false);
  const [tasks, setTasks] = useState(false);
  return (
    <DraftContext.Provider value={workspace}>
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
              component={WorkspaceLink}
              href="/"
              active={!settings}
              label="应用管理"
              leftSection={<Layers size={18} />}
            />
            <NavLink
              onNavigate={closeNavigation}
              component={WorkspaceLink}
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
              disabled={!workspace.saved || workspace.blocked}
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
              {saveError && (
                <Alert
                  color="red"
                  withCloseButton
                  onClose={() => setSaveError("")}
                >
                  {saveError}
                </Alert>
              )}
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
    </DraftContext.Provider>
  );
}
