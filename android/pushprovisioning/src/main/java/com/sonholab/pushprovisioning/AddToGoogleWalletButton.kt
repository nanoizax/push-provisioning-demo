package com.sonholab.pushprovisioning

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * "Add to Google Wallet" button, styled to resemble the official Google Wallet
 * button: a dark rounded pill with a wallet glyph and the "Add to Google Wallet"
 * label.
 *
 * NOTE ON BRANDING: Google ships official, localized button assets (SVG/PNG) and
 * strict brand guidelines for the real button. In a production issuer app you
 * MUST use those official assets from the Google Wallet API guidelines, not a
 * hand-drawn glyph. The Canvas glyph below is a lightweight placeholder so the
 * demo is self-contained and asset-free.
 *
 * @param enabled when false the button is dimmed and non-clickable — used to hide
 *        the affordance while eligibility/isTokenized checks are in flight, or
 *        when the card is already in the wallet.
 * @param onClick invoked on tap; the host typically calls the issuer for an OPC
 *        and then [PushProvisioningManager.pushTokenize].
 */
@Composable
fun AddToGoogleWalletButton(
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Google Wallet button surface color is a near-black.
    val surface = Color(0xFF000000)
    val contentColor = Color.White

    Row(
        modifier = modifier
            .height(48.dp)
            .clip(RoundedCornerShape(50)) // fully rounded pill
            .background(surface)
            // Only wire the click when enabled; dim otherwise.
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .alpha(if (enabled) 1f else 0.4f)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        WalletGlyph(
            modifier = Modifier.size(22.dp),
            tint = contentColor,
        )
        Text(
            text = "Add to Google Wallet",
            color = contentColor,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

/**
 * Minimal wallet glyph drawn with Canvas: a rounded "card holder" with a small
 * clasp on the right. This is a stand-in for Google's official wallet mark.
 */
@Composable
private fun WalletGlyph(
    modifier: Modifier = Modifier,
    tint: Color = Color.White,
) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val corner = h * 0.22f

        // Wallet body: a rounded rectangle.
        val body = Path().apply {
            addRoundRect(
                androidx.compose.ui.geometry.RoundRect(
                    left = 0f,
                    top = h * 0.18f,
                    right = w,
                    bottom = h * 0.86f,
                    radiusX = corner,
                    radiusY = corner,
                )
            )
        }
        drawPath(body, color = tint)

        // Clasp: a small filled circle on the right edge, punched with a darker
        // dot to read as a button/snap.
        val claspCx = w * 0.80f
        val claspCy = h * 0.52f
        drawCircle(
            color = tint,
            radius = h * 0.14f,
            center = Offset(claspCx, claspCy),
        )
        drawCircle(
            color = Color(0xFF000000),
            radius = h * 0.06f,
            center = Offset(claspCx, claspCy),
        )
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFEDEDED)
@Composable
private fun AddToGoogleWalletButtonPreview() {
    AddToGoogleWalletButton(enabled = true, onClick = {})
}

@Preview(showBackground = true, backgroundColor = 0xFFEDEDED)
@Composable
private fun AddToGoogleWalletButtonDisabledPreview() {
    AddToGoogleWalletButton(enabled = false, onClick = {})
}
