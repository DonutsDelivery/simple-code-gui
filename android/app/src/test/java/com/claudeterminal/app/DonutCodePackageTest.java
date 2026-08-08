package com.claudeterminal.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Host-side packaging contract smoke test (no Android device required). */
public class DonutCodePackageTest {
    @Test
    public void packageAndVersionComeFromProductConfiguration() {
        assertEquals("com.claudeterminal.app", BuildConfig.APPLICATION_ID);
        assertTrue(BuildConfig.VERSION_NAME.matches("\\d+\\.\\d+\\.\\d+.*"));
        assertTrue(BuildConfig.VERSION_CODE > 0);
    }
}
