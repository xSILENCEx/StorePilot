import { SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { ConnectionCard } from "../../../components/connection-card";

export default function Settings() {
  return (
    <Stack gap="xl">
      <div className="page-heading">
        <Title order={1} size={30}>
          模型配置
        </Title>
        <Text size="sm" c="dimmed" mt="xs">
          文本与图像模型配置由工作空间内的所有项目共享。
        </Text>
      </div>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <ConnectionCard scope="text" />
        <ConnectionCard scope="image" />
      </SimpleGrid>
    </Stack>
  );
}
