"use client";
import { useState } from "react";
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { ArrowRight, Download, Layers, Plus, Search } from "lucide-react";
import type { StoreApp } from "../lib/model";
export function WorkspaceAppList({
  apps,
  editable,
  ready,
  openSettings,
  openApp,
  download,
}: {
  apps: StoreApp[];
  editable: boolean;
  ready: boolean;
  openSettings: () => void;
  openApp: (app: StoreApp) => void;
  download: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = apps.filter((a) =>
    `${a.name} ${a.apple} ${a.google}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <Group justify="space-between" className="page-heading">
        <div>
          <Text className="eyebrow" mb={10}>
            YOUR STORE WORKSPACE
          </Text>
          <Title order={1} size={30}>
            应用管理
          </Title>
          <Text c="dimmed" size="sm" mt="xs">
            在一个地方，准备每个平台、每种语言的商店资料。
          </Text>
        </div>
        <Button
          leftSection={<Plus size={17} />}
          onClick={() => openSettings()}
          disabled={!editable}
        >
          添加应用
        </Button>
      </Group>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          全部应用{" "}
          <Text component="span" c="dark" fw={600} ml={6}>
            {apps.length}
          </Text>
        </Text>
        <Group>
          <TextInput
            size="sm"
            placeholder="搜索应用"
            aria-label="搜索应用"
            leftSection={<Search size={15} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Tooltip label="导出草稿 JSON">
            <ActionIcon
              variant="default"
              size="lg"
              aria-label="导出草稿"
              onClick={download}
            >
              <Download size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {!ready ? (
        <Center py={80}>
          <Loader size="sm" />
        </Center>
      ) : !apps.length ? (
        <Paper p={60}>
          <Stack align="center" gap="md">
            <Avatar size={68} radius="xl" color="blue">
              <Layers size={29} />
            </Avatar>
            <Title order={3}>从第一个应用开始</Title>
            <Text c="dimmed" size="sm" ta="center">
              整理文案、生成截图，为下一次版本更新做好准备。
            </Text>
            <Button
              leftSection={<Plus size={16} />}
              onClick={() => openSettings()}
              disabled={!editable}
            >
              添加第一个应用
            </Button>
          </Stack>
        </Paper>
      ) : !filtered.length ? (
        <Text c="dimmed" ta="center" py="xl">
          没有找到匹配的应用
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
          {filtered.map((a) => (
            <Paper key={a.id} p="xl" className="app-card">
              <UnstyledButton onClick={() => openApp(a)} w="100%">
                <Stack gap="lg">
                  <Group justify="space-between">
                    <div className="app-card-icons">
                      {a.platformIcons?.apple || a.platformIcons?.google ? (
                        (["apple", "google"] as const).map((store) =>
                          a.platformIcons?.[store] ? (
                            <Avatar
                              key={store}
                              size={52}
                              radius="lg"
                              color="blue"
                              className="app-card-icon"
                              src={a.platformIcons[store]}
                              alt={
                                store === "apple"
                                  ? "App Store 图标"
                                  : "Google Play 图标"
                              }
                            >
                              {a.name.slice(0, 1).toUpperCase()}
                            </Avatar>
                          ) : null,
                        )
                      ) : (
                        <Avatar size={52} radius="lg" color="blue">
                          {a.name.slice(0, 1).toUpperCase()}
                        </Avatar>
                      )}
                    </div>
                    <ArrowRight size={18} color="var(--mantine-color-dimmed)" />
                  </Group>
                  <div>
                    <Title order={3} size="h4">
                      {a.name}
                    </Title>
                    <Text size="xs" c="dimmed" mt={6} lineClamp={1}>
                      {a.apple || a.google}
                    </Text>
                  </div>
                  <Group gap="xs">
                    {a.apple && (
                      <Badge color="gray" variant="light">
                        App Store
                      </Badge>
                    )}
                    {a.google && (
                      <Badge color="gray" variant="light">
                        Google Play
                      </Badge>
                    )}
                  </Group>
                </Stack>
              </UnstyledButton>
            </Paper>
          ))}
        </SimpleGrid>
      )}
    </>
  );
}
