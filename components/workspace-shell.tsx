"use client";
import { useWorkspace } from "../lib/use-workspace";
import Link from "next/link";
import { createContext, useContext, useLayoutEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  Alert,
  Group,
  Text,
  ThemeIcon,
  Button,
  Container,
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
  const title = settings ? "模型配置" : (details.title ?? "应用管理");
  const [tasks, setTasks] = useState(false);
  return (
    <DraftContext.Provider value={workspace}>
      <AppShell
        header={{ height: 70 }}

        padding={0}
      >
        <AppShell.Header>
          <Group h="100%" px="lg" justify="space-between">
            <Group gap="sm">
              <WorkspaceLink
                href="/"
                className="brand"
                aria-label="StorePilot 应用管理"
              >
                <Group gap="xs">
                  <ThemeIcon size={34} radius="md">
                    <Layers size={20} />
                  </ThemeIcon>
                  <Text visibleFrom="xs" fw={750} size="lg" c="dark.8">
                    StorePilot
                  </Text>
                </Group>
              </WorkspaceLink>
              <Text c="dimmed" size="sm" visibleFrom="sm" ml="xl">
                工作空间 / {title}
              </Text>
            </Group>
            <Group
              component="nav"
              aria-label="工作区导航"
              gap="xs"
              wrap="nowrap"
            >
              <Button
                component={WorkspaceLink}
                href="/settings"
                variant={settings ? "light" : "subtle"}
                aria-current={settings ? "page" : undefined}
                size="sm"
                leftSection={<Settings2 size={16} />}
              >
                模型配置
              </Button>
              <Button
                variant="subtle"
                size="sm"
                leftSection={<Activity size={16} />}
                onClick={() => setTasks(true)}
              >
                任务记录
              </Button>
            </Group>
          </Group>
        </AppShell.Header>
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
              <Group component="footer" justify="end" mt="xl">
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
              </Group>
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
