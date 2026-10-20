package com.prosdino.leroy;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Niente effetto elastico sul bordo (Android 12+): allungherebbe tutta
        // la pagina, barra in basso compresa, mentre si trascina per
        // aggiornare. La CSS overscroll-behavior non lo controlla.
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
    }
}
