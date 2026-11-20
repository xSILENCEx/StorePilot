"use client";
import Link from "next/link";
import { useState } from "react";
import {
  AppShell,
  Burger,
  Group,
  Text,
  ThemeIcon,
  NavLink,
  Stack,
  Badge,
  Button,
  Container,
  Box,
} from "@mantine/core";
import { Layers, Settings2, LogOut, Activity } from "lucide-react";
import { TaskDrawer } from "./task-drawer";
export function WorkspaceShell({
  children,
  active = "apps",
  title = "应用管理",
  appId,
  canSignOut = true,
}: {
  children: React.ReactNode;
  active?: "apps" | "settings";
  title?: string;
  appId?: string;
  canSignOut?: boolean;
}) {
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
          <Badge
            color="gray"
            variant="light"
            size="lg"
            leftSection={<span className="status-dot" />}
          >
            本机工作空间
          </Badge>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar className="workspace-nav" py="md" px="xs">
        <Stack gap={6} h="100%">
          <NavLink
            component={Link}
            href="/"
            active={active === "apps"}
            label="应用管理"
            leftSection={<Layers size={18} />}
          />
          <NavLink
            component={Link}
            href="/settings"
            active={active === "settings"}
            label="连接与模型"
            leftSection={<Settings2 size={18} />}
          />
          <NavLink
            component="button"
            label="任务记录"
            leftSection={<Activity size={18} />}
            onClick={() => {
              setTasks(true);
              setOpened(false);
            }}
          />
          <Box style={{ flex: 1 }} />
          <Text className="workspace-nav-caption" size="xs" c="dimmed" px="sm" mb="xs">
            资料与素材保存在本机
          </Text>
          <Button
            variant="subtle"
            color="gray"
            justify="start"
            px="sm"
            leftSection={<LogOut size={16} />}
            disabled={!canSignOut}
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
          {children}
        </Container>
      </AppShell.Main>
      <TaskDrawer
        opened={tasks}
        onClose={() => setTasks(false)}
        appId={appId}
      />
    </AppShell>
  );
}
