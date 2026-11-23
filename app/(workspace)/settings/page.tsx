"use client";
import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ConnectionCard } from "../../../components/connection-card";
import {
  useWorkspaceDrafts,
  WorkspaceLink,
} from "../../../components/workspace-shell";
export default function Settings() {
  const { apps, ready, blocked, retry } = useWorkspaceDrafts();
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected(new URLSearchParams(location.search).get("appId") ?? "");
  }, []);
  const app = apps.find((value) => value.id === selected) ?? apps[0];
  return (
    <>
      <Stack gap="xl">
        <div className="page-heading">
          <Text className="eyebrow" mb={10}>
            CONNECTIONS & MODELS
          </Text>
          <Title order={1} size={30}>
            连接与模型
          </Title>
          <Text size="sm" c="dimmed" mt="xs">
            一次配置，连接商店与 AI。
          </Text>
        </div>
        {!ready && blocked && <Button onClick={retry}>重新加载</Button>}
        <Group justify="space-between">
          <Title order={2} size="h4">
            商店连接
          </Title>
          {!!apps.length && (
            <Select
              size="sm"
              aria-label="选择应用"
              value={app?.id ?? null}
              onChange={(value) => value && setSelected(value)}
              data={apps.map((a) => ({ value: a.id, label: a.name }))}
              w={220}
            />
          )}
        </Group>
        {!ready && !blocked ? (
          <Loader size="sm" />
        ) : app ? (
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <ConnectionCard key={`apple:${app.id}`} scope="apple" app={app} />
            <ConnectionCard key={`google:${app.id}`} scope="google" app={app} />
          </SimpleGrid>
        ) : (
          <Paper p="xl">
            <Text size="sm" c="dimmed">
              先在工作台添加应用，再配置商店连接。
            </Text>
            <Button component={WorkspaceLink} href="/" variant="light" mt="md">
              返回应用管理
            </Button>
          </Paper>
        )}
        <div>
          <Title order={2} size="h4">
            AI 模型
          </Title>
          <Text size="xs" c="dimmed" mt={6}>
            工作空间共享，文本与图像服务可独立选择。
          </Text>
        </div>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <ConnectionCard scope="text" />
          <ConnectionCard scope="image" />
        </SimpleGrid>
      </Stack>
    </>
  );
}
