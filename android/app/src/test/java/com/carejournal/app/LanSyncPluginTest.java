package com.carejournal.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

public class LanSyncPluginTest {
    @Test
    public void truncateUtf8DoesNotSplitMultibyteCharacters() {
        String value = "病程记🙂abc";

        String truncated = LanSyncPlugin.truncateUtf8(value, 10);

        assertEquals("病程记", truncated);
        assertFalse(truncated.contains("�"));
        assertEquals(9, truncated.getBytes(StandardCharsets.UTF_8).length);
    }

    @Test
    public void hostForUrlBracketsIpv6Only() {
        assertEquals("192.168.1.20", LanSyncPlugin.hostForUrl("192.168.1.20"));
        assertEquals("[fe80::1234]", LanSyncPlugin.hostForUrl("fe80::1234"));
        assertEquals("[fe80::1234]", LanSyncPlugin.hostForUrl("[fe80::1234]"));
    }

    @Test
    public void nsdServiceNamePrefixIsOpaqueAsciiAndPadded() {
        assertEquals("cj-abcdef12", LanSyncPlugin.nsdServiceNamePrefix("ABCDEF12-3456"));
        assertEquals("cj-a0000000", LanSyncPlugin.nsdServiceNamePrefix("a!"));
    }
}
