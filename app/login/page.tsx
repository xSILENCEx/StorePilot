"use client";
import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { Layers } from "lucide-react";
export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.message ??
            (typeof data.error === "string"
              ? data.error
              : "登录失败，请检查邮箱和密码"),
        );
      location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <Stack w="100%" maw={420} gap="xl">
        <Group justify="center" gap="xs">
          <ThemeIcon size={36} radius="md">
            <Layers size={21} />
          </ThemeIcon>
          <Text fw={750} size="xl">
            StorePilot
          </Text>
        </Group>
        <Paper p={{ base: "lg", sm: 36 }} radius="lg" shadow="xs">
          <form onSubmit={login}>
            <Stack gap="lg">
              <div>
                <Title order={1} size={25}>
                  欢迎回来
                </Title>
                <Text c="dimmed" size="sm" mt="xs">
                  登录你的商店资料工作空间。
                </Text>
              </div>
              {error && <Alert color="red">{error}</Alert>}
              <TextInput
                label="邮箱"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                placeholder="admin@example.com"
              />
              <PasswordInput
                label="密码"
                name="password"
                autoComplete="current-password"
                required
                placeholder="输入管理员密码"
              />
              <Button type="submit" fullWidth loading={busy} mt="xs">
                登录工作台
              </Button>
            </Stack>
          </form>
        </Paper>
        <Text size="xs" c="dimmed" ta="center">
          仅管理员访问 · 公开注册已关闭
        </Text>
      </Stack>
    </main>
  );
}
