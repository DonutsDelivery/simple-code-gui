package com.claudeterminal.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Device smoke: launch the real Capacitor activity and verify its app identity. */
@RunWith(AndroidJUnit4.class)
public class DonutCodeLaunchTest {
    @Test
    public void launchesCapacitorActivity() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge());
                assertNotNull(activity.getBridge().getWebView());
                assertEquals("com.claudeterminal.app", activity.getPackageName());
            });
        }
    }
}
